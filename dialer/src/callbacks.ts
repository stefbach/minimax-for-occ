import type { SupabaseClient } from "@supabase/supabase-js";
import type { DialJob } from "./dial.js";

/**
 * Exact-time AI callbacks (Wati 26/06).
 *
 * The normal dynamic selection only fires callbacks at the campaign's SLOT
 * times (08/13/18…), because the whole campaign tick is gated by the schedule
 * window (main.ts:withinSchedule) + pickDueSlot. But a patient who asked to be
 * called back at 15:00 expects a call AT 15:00, not at the next slot.
 *
 * This module is the dedicated exact-time path. It runs every poll tick,
 * INDEPENDENT of the campaign schedule window, but clamped to sane calling
 * hours (08:00–21:00 UK — the schedule_callback endpoint already clamps the
 * stored time to that range; this is the runtime safety net). For each running
 * campaign with `engine.callback.enabled`, it finds leads that are due
 * (status = status_value AND datetime_column in (now-grace, now]) and seeds a
 * campaign_target so the existing dial path (dialTarget) calls them via the
 * campaign's agent (Charlotte prod).
 *
 * STRICTLY OPT-IN: only runs when env `CALLBACK_EXACT_TIME=1`. Off by default
 * so deploying the dialer doesn't change behaviour until ops enable it (and
 * disable the slot-based callback to avoid two mechanisms — see README).
 *
 * Exactly-once: before seeding we CONSUME the callback with an optimistic-lock
 * update (clear datetime_column WHERE it still equals the value we read). If
 * that update touches 0 rows, another tick already took it — we skip. Clearing
 * the column also means a no-answer lead falls back to normal cadence (Wati's
 * choice), since computePhase's callback branch needs the datetime set.
 */

const GRACE_MS = Math.max(1, Number(process.env.CALLBACK_GRACE_MINUTES ?? "120")) * 60_000;

// 08:00–21:00 UK inclusive. DST-aware via Intl.
function withinUkCallHours(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  let hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  if (hh === 24) hh = 0;
  const mins = hh * 60 + mm;
  return mins >= 8 * 60 && mins <= 21 * 60;
}

// leads_rdv numbers are already E.164; just trim whitespace and require a +.
function normPhone(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, "");
  return /^\+\d{6,15}$/.test(s) ? s : null;
}

/**
 * Select + seed due exact-time callbacks across running callback-enabled
 * campaigns. Returns the DialJobs the caller should dial (with its own
 * concurrency + stagger). Never throws — logs and returns what it has.
 *
 * @param budget  max number of callbacks to seed this tick (concurrency room).
 */
export async function collectExactTimeCallbacks(
  sb: SupabaseClient,
  now: Date,
  budget: number,
): Promise<DialJob[]> {
  if (process.env.CALLBACK_EXACT_TIME !== "1") return [];
  if (budget <= 0) return [];
  if (!withinUkCallHours(now)) return [];

  const jobs: DialJob[] = [];
  try {
    const { data: camps, error } = await sb
      .from("campaigns")
      .select("id, org_id, data_table_id, metadata, max_concurrency")
      .eq("state", "running");
    if (error) {
      console.error("[callbacks] list campaigns failed:", error.message);
      return [];
    }

    for (const c of (camps ?? []) as Array<Record<string, unknown>>) {
      if (jobs.length >= budget) break;
      const engine = (c.metadata as { engine?: Record<string, unknown> } | null)?.engine;
      const cb = engine?.callback as { enabled?: boolean; status_value?: string; datetime_column?: string } | undefined;
      const dataTableId = c.data_table_id as string | null;
      if (!cb?.enabled || !cb.datetime_column || !dataTableId) continue;
      const statusCol = ((engine?.selection as { status_column?: string } | undefined)?.status_column) ?? "qualification";
      const statusVal = cb.status_value ?? "RAPPEL";
      const dtCol = cb.datetime_column;
      const campaignId = c.id as string;
      const orgId = c.org_id as string;

      // Resolve the physical table + phone column (same as dynamic-selection).
      const { data: reg } = await sb
        .from("tenant_data_tables")
        .select("physical_table, phone_column")
        .eq("id", dataTableId)
        .maybeSingle();
      const r = reg as { physical_table?: string; phone_column?: string } | null;
      if (!r?.physical_table) continue;
      const table = r.physical_table;
      const phoneCol = r.phone_column || "numero_telephone";

      // Per-campaign concurrency room.
      const { count: dialingCount } = await sb
        .from("campaign_targets")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", "dialing");
      const maxConc = Number(c.max_concurrency ?? 5);
      const campBudget = Math.max(0, Math.min(budget - jobs.length, maxConc - (dialingCount ?? 0)));
      if (campBudget === 0) continue;

      // Due callbacks: status matches, datetime in (now-grace, now], not opted out.
      const sinceIso = new Date(now.getTime() - GRACE_MS).toISOString();
      // select("*") (not a template literal) — the typed client can't parse a
      // select() with interpolated dynamic column names. We read the dynamic
      // columns off the row by name below.
      const { data: due, error: dueErr } = await sb
        .from(table)
        .select("*")
        .eq(statusCol, statusVal)
        .eq("do_not_call", false)
        .gt(dtCol, sinceIso)
        .lte(dtCol, now.toISOString())
        .order(dtCol, { ascending: true })
        .limit(campBudget);
      if (dueErr) {
        console.error(`[callbacks] campaign=${campaignId} due query failed:`, dueErr.message);
        continue;
      }

      for (const row of (due ?? []) as unknown as Array<Record<string, unknown>>) {
        if (jobs.length >= budget) break;
        const e164 = normPhone(row[phoneCol]);
        if (!e164) continue;
        const dtVal = row[dtCol];

        // Consume the callback (optimistic lock) — clear datetime only if it
        // hasn't changed since we read it. 0 rows → another tick took it.
        const { data: cleared } = await sb
          .from(table)
          .update({ [dtCol]: null })
          .eq("id", row.id as string)
          .eq(dtCol, dtVal as string)
          .select("id");
        if (!cleared || (cleared as unknown[]).length === 0) continue;

        // Seed contact + campaign_target so dialTarget dials via Charlotte.
        const { data: contact } = await sb
          .from("contacts")
          .upsert({ org_id: orgId, e164, display_name: (row.nom as string) ?? null }, { onConflict: "org_id,e164" })
          .select("id")
          .maybeSingle();
        const contactId = (contact as { id?: string } | null)?.id;
        if (!contactId) continue;

        const { data: target } = await sb
          .from("campaign_targets")
          .upsert(
            { campaign_id: campaignId, contact_id: contactId, status: "pending", next_attempt_at: now.toISOString() },
            { onConflict: "campaign_id,contact_id" },
          )
          .select("id")
          .maybeSingle();
        const targetId = (target as { id?: string } | null)?.id;
        if (!targetId) continue;

        console.log(`[callbacks] exact-time callback due → campaign=${campaignId} to=${e164} (was ${String(dtVal)})`);
        jobs.push({ target_id: targetId, campaign_id: campaignId });
      }
    }
  } catch (e) {
    console.error("[callbacks] collectExactTimeCallbacks error:", (e as Error)?.message);
  }
  return jobs;
}
