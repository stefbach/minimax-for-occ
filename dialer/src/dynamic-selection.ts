import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Normalise any messy phone number (with spaces, dashes, leading 0, missing +)
 * into strict E.164. Defaults UK ("07..." → "+447...") because OCC's leads
 * are UK patients; override DEFAULT_COUNTRY_PREFIX env if a tenant needs a
 * different default.
 *
 * Returns empty string if the input is unparseable (caller filters out empty).
 */
function normalisePhoneToE164(raw: string): string {
  if (!raw) return "";
  // Strip every whitespace + every common separator, keep only + and digits.
  const cleaned = String(raw).replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned; // already E.164-ish
  // UK national format: 07xxxxxxxxx → +447xxxxxxxxx (11 digits starting with 0)
  if (/^0\d{10}$/.test(cleaned)) {
    return "+44" + cleaned.slice(1);
  }
  // UK national without leading 0 but 10 digits starting with 7 → +44 prefix
  if (/^7\d{9}$/.test(cleaned)) {
    return "+44" + cleaned;
  }
  // Country-prefix fallback (env-tunable for multi-tenant).
  const defaultCC = process.env.DEFAULT_COUNTRY_PREFIX ?? "+44";
  return defaultCC + cleaned;
}

/**
 * Dynamic ("continuous") campaign engine.
 *
 * At each configured time slot, re-select leads from the campaign's data
 * table according to the client-mapped rules in campaigns.metadata.engine,
 * then seed them as `pending` campaign_targets (with payload for {{vars}} and
 * source_metadata for write-back). The existing dialing loop in main.ts then
 * places the calls, respecting concurrency.
 *
 * Everything is column-MAPPED so any tenant's table works without hardcoded
 * names (Q1=B). Mirrors OCC's J1/J3/J5 n8n logic, generalised.
 */

// ── Config shape (campaigns.metadata.engine) ────────────────────────────
interface Phase {
  name: string;
  date_column: string;
  attempts_column: string;
  wait_business_days: number;
}
interface EngineConfig {
  selection: {
    status_column: string;
    include_statuses: string[];
    phone_starts_with: string;
    phone_min_len: number | null;
    phone_max_len: number | null;
  };
  callback: { enabled: boolean; status_value: string; datetime_column: string };
  cadence: {
    enabled: boolean;
    business_days_only: boolean;
    max_attempts_per_phase: number;
    phases: Phase[];
  };
  slots: { days: number[]; hours: string[]; timezone: string };
  volume: { max_new_per_day: number; wave_size: number; wave_pause_secs: number };
}

interface CampaignRow {
  id: string;
  org_id: string;
  data_table_id: string | null;
  metadata: { engine?: EngineConfig } | null;
}

// ── Timezone helpers ────────────────────────────────────────────────────
function zonedParts(now: Date, tz: string): { weekday: number; minutes: number; dateStr: string } {
  // Intl gives us the wall-clock parts in the target timezone.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.weekday as string] ?? now.getUTCDay();
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  return { weekday, minutes, dateStr };
}

function subtractBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let count = 0;
  while (count < days) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return d;
}

function subtractCalendarDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

// ── Phase computation for one lead ──────────────────────────────────────
function computePhase(row: Record<string, unknown>, engine: EngineConfig, now: Date): string | null {
  const cad = engine.cadence;
  const cutoff = (waitDays: number) =>
    cad.business_days_only ? subtractBusinessDays(now, waitDays) : subtractCalendarDays(now, waitDays);

  // Callback first: status == callback value AND callback datetime due.
  if (engine.callback.enabled && engine.callback.datetime_column) {
    const status = String(row[engine.selection.status_column] ?? "");
    const cb = row[engine.callback.datetime_column];
    if (status === engine.callback.status_value && cb && new Date(String(cb)) <= now) {
      return "RAPPEL";
    }
  }

  if (!cad.enabled || cad.phases.length === 0) {
    // No cadence: a lead is eligible once (treat as the single phase).
    return "ONCE";
  }

  const phases = cad.phases;
  // Phase 0 (J1): none of the phase date columns are set (never called).
  const anyDateSet = phases.some((p) => row[p.date_column] != null && row[p.date_column] !== "");
  if (!anyDateSet) return phases[0].name;

  // Phase i (>0): previous phase date is set AND old enough; own date not set.
  for (let i = 1; i < phases.length; i++) {
    const prev = phases[i - 1];
    const cur = phases[i];
    const prevDate = row[prev.date_column];
    const curDate = row[cur.date_column];
    if (prevDate && (curDate == null || curDate === "")) {
      if (new Date(String(prevDate)) <= cutoff(cur.wait_business_days)) {
        return cur.name;
      }
    }
  }
  return null; // not due
}

// ── Phone filter ────────────────────────────────────────────────────────
function phoneOk(tel: string, sel: EngineConfig["selection"]): boolean {
  const t = (tel ?? "").trim();
  if (!t) return false;
  if (sel.phone_starts_with && !t.startsWith(sel.phone_starts_with)) return false;
  if (sel.phone_min_len && t.length < sel.phone_min_len) return false;
  if (sel.phone_max_len && t.length > sel.phone_max_len) return false;
  return true;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Main entry: run selection for one dynamic campaign ──────────────────
export async function runDynamicSelection(sb: SupabaseClient, campaign: CampaignRow, now = new Date()): Promise<void> {
  const engine = campaign.metadata?.engine;
  if (!engine || !campaign.data_table_id) return;

  const tz = engine.slots.timezone || "UTC";
  const { weekday, minutes, dateStr } = zonedParts(now, tz);

  // Day active?
  if (Array.isArray(engine.slots.days) && engine.slots.days.length > 0 && !engine.slots.days.includes(weekday)) {
    return;
  }

  // Which slot (if any) is due and hasn't run yet today?
  const dueSlot = pickDueSlot(engine.slots.hours, minutes);
  if (!dueSlot) return;

  const { data: existingRun } = await sb
    .from("campaign_runs")
    .select("id")
    .eq("campaign_id", campaign.id)
    .eq("run_date", dateStr)
    .eq("slot_label", dueSlot)
    .maybeSingle();
  if (existingRun) return; // already ran this slot today

  // Resolve the physical table + phone column.
  const { data: reg } = await sb
    .from("tenant_data_tables")
    .select("physical_table, phone_column")
    .eq("id", campaign.data_table_id)
    .eq("org_id", campaign.org_id)
    .maybeSingle();
  if (!reg) return;
  const table = reg.physical_table as string;
  const phoneCol = (reg.phone_column as string) || "numero_telephone";

  // Insert the run row early to claim this slot. The UNIQUE(campaign_id,
  // run_date, slot_label) constraint makes this an atomic claim: if a
  // concurrent tick already inserted, this errors and we bail (no double-seed).
  const { data: runRow, error: claimErr } = await sb
    .from("campaign_runs")
    .insert({
      campaign_id: campaign.id,
      org_id: campaign.org_id,
      run_date: dateStr,
      slot_label: dueSlot,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (claimErr || !runRow) return; // lost the race (or insert failed) — skip

  try {
    // Pull candidate leads. Three hard exclusions are applied regardless of
    // the campaign's `include_statuses` to keep OCC compliant with GDPR and
    // Ofcom (UK Telephone Consumer rules):
    //   • do_not_call = true        — patient explicitly opted out
    //   • cycle_status != 'ACTIF'   — closed dossiers / already-RDV'd leads
    //   • qualification in NEGATIVE — patients flagged as do-not-pursue
    // The whitelist on status_column still applies on top so the operator's
    // include_statuses (e.g. NOUVEAU DOSSIER + RAPPEL) further narrows it.
    const NEGATIVE_QUALS = [
      "RDV CONFIRME",
      "FAUX NUMERO",
      "NE PAS RAPPELER",
      "NON ELIGIBLE",
      "PAS INTERESSE",
      "A PASSER A L'HUMAIN",
    ];
    let q = sb
      .from(table)
      .select("*")
      .eq("do_not_call", false)
      .eq("cycle_status", "ACTIF")
      .not("qualification", "in", `(${NEGATIVE_QUALS.map((q) => `"${q}"`).join(",")})`)
      .limit(20000);
    if (engine.selection.include_statuses.length > 0) {
      q = q.in(engine.selection.status_column, engine.selection.include_statuses);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const all = (rows ?? []) as Record<string, unknown>[];

    // Compute phase + filter phone.
    const eligible = all
      .map((r) => ({ row: r, phase: computePhase(r, engine, now) }))
      .filter((x) => x.phase !== null && phoneOk(String(x.row[phoneCol] ?? ""), engine.selection));

    // Priority: callbacks first, then phase order, fresh (J1/ONCE) capped per day.
    const callbacks = eligible.filter((x) => x.phase === "RAPPEL");
    const firstPhaseName = engine.cadence.phases[0]?.name ?? "ONCE";
    const firstPhaseCfg = engine.cadence.phases[0];
    const freshAll = eligible.filter((x) => x.phase === firstPhaseName || x.phase === "ONCE");
    const laterPhases = eligible.filter(
      (x) => x.phase !== "RAPPEL" && x.phase !== firstPhaseName && x.phase !== "ONCE",
    );

    // OCC model: each lead gets up to N attempts in a phase, ALL on the same
    // day (slot 08/13/18). Then phase date is stamped and the lead waits
    // wait_business_days for the next phase. Implementation:
    //   • A lead with attempts > 0 in first-phase = mid-batch (already tried
    //     today or carried over from a prior morning) → MUST be re-tried this
    //     slot, counts toward the day's batch.
    //   • A lead with attempts = 0 = brand-new → can only be picked at the
    //     FIRST slot of the day (08:00 by convention). At 13:00/18:00 we
    //     don't top up the batch with new leads — we just retry the morning's
    //     batch through their remaining max_attempts_per_phase attempts.
    //   • Total batch size cap = max_new_per_day (default 200), including
    //     both carryovers and brand-new of the first-phase.
    const attemptsCol = firstPhaseCfg?.attempts_column ?? "j1_attempts";
    const freshRetries = freshAll.filter((x) => Number(x.row[attemptsCol]) > 0);
    const freshNew = shuffle(freshAll.filter((x) => !(Number(x.row[attemptsCol]) > 0)));

    const sortedHours = [...(engine.slots.hours ?? [])].sort();
    const isFirstSlotOfDay = dueSlot === sortedHours[0];

    const dayCap = engine.volume.max_new_per_day ?? 200;
    const remainingCap = Math.max(0, dayCap - freshRetries.length);
    const freshNewCapped = isFirstSlotOfDay ? freshNew.slice(0, remainingCap) : [];
    const fresh = [...freshRetries, ...freshNewCapped];

    const selected = [...callbacks, ...laterPhases, ...fresh];

    if (selected.length === 0) {
      await sb.from("campaign_runs").update({ finished_at: new Date().toISOString(), selected: 0, launched: 0 }).eq("id", runRow?.id);
      return;
    }

    // Seed shim contacts + campaign_targets, and do phase bookkeeping.
    const seeded = await seedSelected(sb, campaign, table, phoneCol, engine, selected, dateStr);

    const byPhase: Record<string, number> = {};
    for (const s of selected) byPhase[s.phase as string] = (byPhase[s.phase as string] ?? 0) + 1;

    await sb
      .from("campaign_runs")
      .update({ finished_at: new Date().toISOString(), selected: selected.length, launched: seeded, by_phase: byPhase })
      .eq("id", runRow?.id);

    console.log(`[dynamic] campaign=${campaign.id} slot=${dueSlot} selected=${selected.length} byPhase=${JSON.stringify(byPhase)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("campaign_runs").update({ finished_at: new Date().toISOString(), error: msg }).eq("id", runRow?.id);
    console.error(`[dynamic] campaign=${campaign.id} selection failed:`, msg);
  }
}

function pickDueSlot(hours: string[], nowMinutes: number): string | null {
  // A slot is "due" if its time has passed AND we're still within the grace
  // window (default 30 min). This lets the dialer recover from a short
  // outage but prevents a 09:00 slot from firing at 16:00 if the campaign
  // was just started — operators set 09:00 expecting morning calls, not a
  // burst at whatever time they happen to click "Start".
  const graceMin = Number(process.env.SLOT_GRACE_MINUTES ?? "30");
  let best: { label: string; m: number } | null = null;
  for (const h of hours ?? []) {
    const [hh, mm] = h.split(":").map(Number);
    const m = (hh || 0) * 60 + (mm || 0);
    if (nowMinutes >= m && nowMinutes - m <= graceMin && (!best || m > best.m)) {
      best = { label: h, m };
    }
  }
  return best?.label ?? null;
}

// ── Seed selected leads as campaign_targets + phase bookkeeping ──────────
async function seedSelected(
  sb: SupabaseClient,
  campaign: CampaignRow,
  table: string,
  phoneCol: string,
  engine: EngineConfig,
  selected: Array<{ row: Record<string, unknown>; phase: string | null }>,
  todayStr: string,
): Promise<number> {
  // 1. Upsert shim contacts.
  const contactsPayload = selected.map((s) => {
    const tel = normalisePhoneToE164(String(s.row[phoneCol] ?? ""));
    const e164 = tel;
    return { org_id: campaign.org_id, e164, display_name: (s.row["nom"] as string) ?? null };
  });
  const { data: contacts } = await sb
    .from("contacts")
    .upsert(contactsPayload, { onConflict: "org_id,e164" })
    .select("id,e164");
  const contactByE164 = new Map<string, string>();
  for (const c of contacts ?? []) contactByE164.set(c.e164 as string, c.id as string);

  const nowIso = new Date().toISOString();
  const targetRows: object[] = [];
  for (const s of selected) {
    const tel = normalisePhoneToE164(String(s.row[phoneCol] ?? ""));
    const e164 = tel;
    const contact_id = contactByE164.get(e164);
    if (!contact_id) continue;
    targetRows.push({
      campaign_id: campaign.id,
      contact_id,
      status: "pending",
      next_attempt_at: nowIso, // dial immediately
      payload: s.row,
      source: "data_table_dynamic",
      source_metadata: {
        physical_table: table,
        row_id: s.row.id ?? null,
        phone_column: phoneCol,
        phase: s.phase,
      },
    });
  }

  // 2. Insert targets (ignore dup so a lead already pending isn't re-queued).
  //    `.select()` returns ONLY the rows actually inserted — duplicates that
  //    were ignored are absent. We bookkeep against exactly those, so a lead
  //    already pending from an earlier slot isn't counted/advanced twice.
  let insertedContactIds = new Set<string>();
  if (targetRows.length > 0) {
    const { data: inserted } = await sb
      .from("campaign_targets")
      .upsert(targetRows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true })
      .select("contact_id");
    insertedContactIds = new Set((inserted ?? []).map((r) => r.contact_id as string));
  }

  // Phase bookkeeping (attempts++/date_jN stamp) is intentionally NOT done
  // here. It now happens server-side in /api/calls/[id]/sync-lead AFTER the
  // call completes — that endpoint reads the call's outcome and decides
  // whether to increment + stamp based on terminal-vs-PAS_DE_REPONSE
  // semantics. Doing it twice (here at dispatch + there at call end) caused
  // double-counting that prematurely graduated leads out of their phase
  // (a single 08:00 call would land at attempts=2 by 09:00 and date_j1
  // already stamped by 13:00 — a bug we observed in production).

  return insertedContactIds.size;
}
