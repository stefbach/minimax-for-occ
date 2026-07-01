import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { bucketForCall, QUAL_BUCKETS, type QualBucket } from "@/lib/qualification";
import { isInbound, normalizeDirectionForDb } from "@/lib/call-direction";
import { callInLeadsScope, campaignScopeFor, leadsTableFor, leadsScopeFor, type LeadsSource } from "@/lib/leads-source";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";
import { callMatchesSystem, parseCallSystem } from "@/lib/call-system";
import { isPhantomCall, isSoftphoneTestLeg } from "@/lib/call-quality";
import { slotForDate } from "@/lib/call-slots";
import {
  parseGlobalFilters, hasActiveGlobalFilters, hasLeadScopedFilters, matchesGlobalFilters,
  buildLeadFilterIndex, buildAttemptIndex, eligibilityForPhone, EMPTY_LEAD_INDEX,
} from "@/lib/global-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vue d'ensemble — clones the OCC Retell exec summary as closely as the
// Axon schema allows. One endpoint computes every section so the client
// hits a single URL per period change.

const ACTIVE = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);

export type CostProviderRow = {
  event_type: string;
  label: string;
  color: string;
  cost: number;
  pct: number;
  freeTier?: boolean;
};

export type DirectorKpis = {
  totalCalls: number;
  answered: number;
  answeredUniqueContacts: number;
  notAnswered: number;
  answeredPct: number;
  cost: number;
  costByProvider: CostProviderRow[];
  totalUniqueLeads: number;
  answeredUniqueLeads: number;
  rdvConfirmed: number;
  conversionRate: number;
  avgDuration: number;
  callbacks: number;
  callsOverThreshold: number;
  threshold: number;
};

export type DirectorResponse = {
  kpis: DirectorKpis;
  inbound: { total: number; answered: number; notAnswered: number };
  qualifications: { key: QualBucket; label: string; count: number }[];
  // Same buckets but counting unique leads (by contact_id or to_e164), taking
  // the most recent call's qualification per lead.
  qualificationsUnique: { key: QualBucket; label: string; count: number }[];
  // Answered calls the agent left unqualified (hidden "autre" bucket). Surfaced
  // so the UI can offer post-hoc AI qualification instead of dropping them.
  unqualified: number;
  // Answered calls still needing an AI pass — unqualified OR (long enough and)
  // missing agent-chain stage detection. Drives the automatic background drain.
  pendingAnalysis: number;
  slots: { matin: number; midi: number; soir: number; hors: number };
  phases: { rappel: PhaseStat; j1: PhaseStat; j3: PhaseStat; j5: PhaseStat };
  // Date context for the phases block. Phase counts span the WHOLE leads
  // pipeline (not the selected period), so the UI needs an explicit "as of"
  // timestamp and a total to label the section honestly.
  phaseContext: { totalLeads: number; asOf: string; period: { from: string; to: string } };
  agentChain: { only1: number; plus2: number; plus3: number };
  durationBuckets: { lt15s: number; s15_60: number; m1_2: number; m2_3: number; m3_5: number; gt5m: number };
  summaries: SummaryRow[];
  humanCallbacks: HumanCallbackRow[];
  hints: { phasesAvailable: boolean; summariesAvailable: boolean };
};

// Per-phase counters. `leads`/`calls` are pipeline-wide totals; the date
// buckets split leads by where their scheduled date_jX sits relative to today
// so the operator can see what actually needs calling.
type PhaseStat = {
  leads: number;
  calls: number;
  dueToday: number;
  overdue: number;
  upcoming: number;
};

type SummaryRow = {
  call_id: string;
  contact_name: string | null;
  qualification: QualBucket;
  qualification_label: string;
  agent_name: string | null;
  duration: number;
  started_at: string;
  summary: string;
};

type HumanCallbackRow = {
  task_id: string;
  contact_name: string | null;
  phone: string | null;
  qualification: string | null;
  scheduled_for: string | null;
  status: string;
};

type CallRow = {
  id: string;
  direction: string | null;
  state: string | null;
  answered_at: string | null;
  started_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  agent_handle_id: string | null;
  contact_id: string | null;
  to_e164: string | null;
  summary: string | null;
  metadata: { qualification?: string | null; agent_stage?: number | null; analysis_skipped?: string | null } | null;
  agent_handles?: { display_name: string | null } | null;
  contacts?: { display_name: string | null } | null;
};

function durationBucketFor(secs: number): keyof DirectorResponse["durationBuckets"] {
  if (secs < 15) return "lt15s";
  if (secs < 60) return "s15_60";
  if (secs < 120) return "m1_2";
  if (secs < 180) return "m2_3";
  if (secs < 300) return "m3_5";
  return "gt5m";
}

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const now = new Date();
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;
  const from = searchParams.get("from")
    ? new Date(searchParams.get("from")!)
    : new Date(now.getTime() - 7 * 86400_000);
  const threshold = Number(searchParams.get("threshold") ?? 60);
  const direction = searchParams.get("direction");
  // Lets the operator flip between the production leads table and the
  // sandbox test table used to validate new flows without polluting OCC's
  // production stats. Defaults to prod.
  const leadsSource: LeadsSource = searchParams.get("leads_source") === "test" ? "test" : "prod";
  const leadsTable = leadsTableFor(leadsSource);
  const system = parseCallSystem(searchParams.get("system"));
  const campaignId = searchParams.get("campaign_id");
  // Optional slot filter: limit every KPI on the page to calls that
  // started during the chosen UK calling window. Computed below with
  // slotForDate so the SQL stays simple (broad time range) and the
  // post-filter handles the DST-aware bucket.
  const slotFilter = ((): "matin" | "midi" | "soir" | null => {
    const s = searchParams.get("slot");
    if (s === "morning") return "matin";
    if (s === "afternoon") return "midi";
    if (s === "evening") return "soir";
    return null;
  })();
  // Global filter-bar constraints (durée / qualification / source / agent /
  // tentative / éligibilité / décroché / recherche). All-pass when absent.
  const gf = parseGlobalFilters((k) => searchParams.get(k));

  const sb = supabaseServer();

  // Main calls query — covers KPIs, qualifications, slots, durations,
  // inbound counts, and the summaries section in one round-trip. Paged past
  // the 1000-row PostgREST cap so wide periods (7d / Tout) aren't truncated.
  const dbDirection = normalizeDirectionForDb(direction);
  const { rows: data, error } = await fetchAllPaged<CallRow>(() => {
    let q = sb
      .from("calls")
      .select(
        "id, direction, state, answered_at, started_at, duration_secs, disposition, agent_handle_id, contact_id, to_e164, summary, metadata, agent_handles(display_name), contacts(display_name)",
      )
      .eq("org_id", orgId)
      .gte("started_at", from.toISOString())
      .lte("started_at", to.toISOString())
      .order("started_at", { ascending: false });
    if (dbDirection) q = q.eq("direction", dbDirection);
    return q as unknown as Rangeable<CallRow>;
  });
  if (error) return NextResponse.json({ error }, { status: 500 });

  // Restrict every KPI on this dashboard to calls placed to leads from the
  // selected table (Prod or Test). Without this filter the Total / Coût /
  // RDV tiles would mix sandbox + production numbers, which is what the
  // operator was actually seeing in the original toggle UX.
  const [scope, campaignScope] = await Promise.all([
    leadsScopeFor(leadsSource),
    campaignId && campaignId !== "all" ? campaignScopeFor(campaignId) : Promise.resolve(null),
  ]);

  let rows = ((data ?? []) as unknown as CallRow[]).filter(
    (r) =>
      !ACTIVE.has(r.state ?? "")
      && !isPhantomCall(r)
      && callInLeadsScope(r.to_e164 ?? null, scope)
      && (callInLeadsScope(r.to_e164 ?? null, campaignScope) || (r.metadata as any)?.campaign_id === campaignId)
      && callMatchesSystem((r.metadata as { source?: string } | null)?.source, system)
      // Skip the Twilio-side inbound legs of /desk softphone outbound calls
      // — Wati's June 10 manual tests created phantom 'AUTRE' rows like
      // from_e164='client:user-ac25040f-...' that aren't real conversations.
      // The OUTBOUND companion row (direction=out, to=+44...) is the real
      // one and stays in the totals.
      && !isSoftphoneTestLeg(r)
      && (!slotFilter || (r.started_at && slotForDate(new Date(r.started_at)) === slotFilter)),
  );

  // Global filter bar — applied before every aggregation so all the cards on
  // Vue d'ensemble reflect exactly the operator's selection. The leads index
  // (BMI / source / nom by phone) is only fetched when a filter needs it.
  if (hasActiveGlobalFilters(gf)) {
    let leadIdx = EMPTY_LEAD_INDEX;
    if (hasLeadScopedFilters(gf) || gf.q) {
      try {
        type GfLead = { nom: string | null; numero_telephone: string | null; source_lead: string | null; bmi: number | null };
        const { rows: gfLeads, error: gfErr } = await fetchAllPaged<GfLead>(() =>
          sb
            .from(leadsTable as never)
            .select("nom, numero_telephone, source_lead, bmi")
            .not("numero_telephone", "is", null) as unknown as Rangeable<GfLead>,
        );
        if (!gfErr) leadIdx = buildLeadFilterIndex(gfLeads);
      } catch {
        /* tenant without a leads table — lead-scoped filters resolve to "unknown" */
      }
    }
    const attemptIdx = buildAttemptIndex(rows);
    rows = rows.filter((r) =>
      matchesGlobalFilters(gf, {
        durationSecs: r.duration_secs ?? 0,
        bucket: bucketForCall(r),
        agent: r.agent_handles?.display_name ?? null,
        answered: !!r.answered_at,
        attempt: r.to_e164 ? attemptIdx.get(r.id) ?? null : null,
        eligibility: eligibilityForPhone(r.to_e164, leadIdx),
        source: (r.to_e164 && leadIdx.sourceByPhone.get(r.to_e164)) || null,
        haystack: [
          r.contacts?.display_name ?? "",
          (r.to_e164 && leadIdx.nameByPhone.get(r.to_e164)) ?? "",
          r.to_e164 ?? "",
          r.summary ?? "",
        ].join(" ").toLowerCase(),
      }),
    );
  }

  // Qualification bucketing — one pass (computed before the KPIs because
  // the décrochés KPI depends on the bucket, see below).
  const qcount: Record<QualBucket, number> = {
    rdv_confirme: 0, passer_humain: 0, rappel: 0, pas_interesse: 0,
    pas_de_reponse: 0, repondeur: 0, faux_numero: 0, non_eligible: 0,
    ne_pas_rappeler: 0, suivi_requis: 0, autre: 0,
  };
  const buckets: { row: CallRow; bucket: QualBucket }[] = [];
  for (const r of rows) {
    const b = bucketForCall(r);
    qcount[b] += 1;
    buckets.push({ row: r, bucket: b });
  }

  // Unique-lead qualification counts: for each lead (contact_id or to_e164),
  // take the most recent call and bucket it. Gives a "per-person" view.
  const qcountUnique: Record<QualBucket, number> = {
    rdv_confirme: 0, passer_humain: 0, rappel: 0, pas_interesse: 0,
    pas_de_reponse: 0, repondeur: 0, faux_numero: 0, non_eligible: 0,
    ne_pas_rappeler: 0, suivi_requis: 0, autre: 0,
  };
  // Buckets that count as "human answered" for the unique-leads view.
  const HUMAN_ANSWERED_BUCKETS = new Set<QualBucket>([
    "rdv_confirme", "passer_humain", "pas_interesse", "rappel",
    "faux_numero", "ne_pas_rappeler", "non_eligible", "suivi_requis",
  ]);
  let totalUniqueLeads = 0;
  let answeredUniqueLeads = 0;
  {
    // Group by lead key, keep latest call per lead.
    const latestByLead = new Map<string, { bucket: QualBucket; started_at: string }>();
    for (const { row, bucket } of buckets) {
      const key = row.contact_id ?? row.to_e164;
      if (!key) continue; // calls with no identifier can't be de-duped
      const existing = latestByLead.get(key);
      if (!existing || (row.started_at ?? "") > existing.started_at) {
        latestByLead.set(key, { bucket, started_at: row.started_at ?? "" });
      }
    }
    totalUniqueLeads = latestByLead.size;
    for (const { bucket } of latestByLead.values()) {
      qcountUnique[bucket] += 1;
      if (HUMAN_ANSWERED_BUCKETS.has(bucket)) answeredUniqueLeads += 1;
    }
  }

  // KPIs.
  //
  // "Décroché" can NOT be derived from answered_at alone on UK mobile
  // routes: carriers like Three answer the SIP leg at the network level in
  // <1s and play the ringback in-band, so Path A stamps answered_at on
  // virtually every dial — the dashboard showed "37 · 100% décrochés"
  // while a third of those calls were voicemails and unanswered rings.
  // A call only counts as décroché when a HUMAN outcome backs it up:
  // answered_at set AND the qualification isn't PAS DE REPONSE / REPONDEUR.
  const humanAnswered = (b: { row: CallRow; bucket: QualBucket }) =>
    !!b.row.answered_at && b.bucket !== "pas_de_reponse" && b.bucket !== "repondeur";
  const total = rows.length;
  const answered = buckets.filter(humanAnswered).length;
  const notAnswered = total - answered;
  const answeredDur = buckets
    .filter(humanAnswered)
    .reduce((a, b) => a + (b.row.duration_secs ?? 0), 0);

  // Count unique answered contacts (distinct people who answered, by to_e164 or contact_id)
  const answeredContacts = new Set<string>();
  for (const b of buckets) {
    if (humanAnswered(b)) {
      const key = b.row.to_e164 ?? b.row.contact_id;
      if (key) answeredContacts.add(key);
    }
  }
  const answeredUniqueContacts = answeredContacts.size;

  const over = rows.filter((r) => (r.duration_secs ?? 0) > threshold).length;

  // Inbound block — independent of the direction filter for this card.
  const inboundRows = rows.filter((r) => isInbound(r.direction));
  const inbound = {
    total: inboundRows.length,
    answered: inboundRows.filter((r) => r.answered_at).length,
    notAnswered: inboundRows.filter((r) => !r.answered_at).length,
  };

  // Créneaux matin / midi / soir / hors — bucketed by the call's UK local time
  // against the OCC calling windows (see lib/call-slots).
  const slots = { matin: 0, midi: 0, soir: 0, hors: 0 };
  for (const r of rows) {
    if (!r.started_at) continue;
    slots[slotForDate(new Date(r.started_at))] += 1;
  }

  // Distribution des durées.
  const durationBuckets = { lt15s: 0, s15_60: 0, m1_2: 0, m2_3: 0, m3_5: 0, gt5m: 0 };
  for (const r of rows) {
    const d = r.duration_secs ?? 0;
    durationBuckets[durationBucketFor(d)] += 1;
  }

  // RDV / callbacks via bucket counts (consistent with the grid).
  const rdvConfirmed = qcount.rdv_confirme;
  const callbacks = qcount.rappel;

  // Cost over the period — but only for the calls that survived the
  // leads-source filter, otherwise the "Coût consommé" tile would still
  // count usage events from sandbox calls when the operator picked Prod
  // (or vice versa). Match on metadata.call_id which is what the agent
  // and Twilio status webhook both set.
  const inScopeIds = new Set(rows.map((r) => r.id));
  const { rows: usage } = await fetchAllPaged<{ event_type: string; cost_cents: number; metadata: { call_id?: string } | null }>(
    () =>
      sb
        .from("usage_events")
        .select("event_type, cost_cents, metadata")
        .eq("org_id", orgId)
        .gte("occurred_at", from.toISOString())
        .lte("occurred_at", to.toISOString()) as unknown as Rangeable<{ event_type: string; cost_cents: number; metadata: { call_id?: string } | null }>,
  );
  const COST_PROVIDERS: { event_type: string; label: string; color: string; freeTier?: boolean }[] = [
    { event_type: "call_minutes", label: "Twilio Voice", color: "#2563eb" },
    { event_type: "llm_tokens",   label: "AI (DeepSeek)", color: "#7c3aed" },
    { event_type: "tts_chars",    label: "Text-to-Speech", color: "#059669" },
    { event_type: "stt_minutes",  label: "Speech-to-Text", color: "#d97706" },
    { event_type: "livekit",      label: "LiveKit", color: "#0ea5e9", freeTier: true },
  ];
  const providerCents: Record<string, number> = Object.fromEntries(COST_PROVIDERS.map((p) => [p.event_type, 0]));
  let totalCostCents = 0;
  const inScopeUsage = usage.filter((u) => {
    if (u.event_type === "retell_call") return false;
    const cid = u.metadata?.call_id;
    if (!cid) return scope === null;
    return inScopeIds.has(cid);
  });
  for (const u of inScopeUsage) {
    const cents = Number(u.cost_cents) || 0;
    totalCostCents += cents;
    if (u.event_type in providerCents) providerCents[u.event_type] += cents;
  }
  const cost = Math.round(totalCostCents) / 100;
  const costByProvider: CostProviderRow[] = COST_PROVIDERS.map((p) => {
    const cents = providerCents[p.event_type] ?? 0;
    return {
      event_type: p.event_type,
      label: p.label,
      color: p.color,
      cost: Math.round((cents / 100) * 100) / 100,
      pct: totalCostCents > 0 ? cents / totalCostCents : 0,
      freeTier: p.freeTier,
    };
  });

  // Chaîne d'agents — count distinct agents touched per call from call_events.
  // Initial agent is calls.agent_handle_id (may be null for inbound). Handoffs
  // are logged with kind='handoff_initiated' and payload.to_agent_id
  // (the agent layer writes {to_agent_id, to_agent_name} — the older `to`
  // shorthand never shipped, but we still accept it for forward-compat).
  // We deliberately skip kind='transfer_pstn_requested': the PSTN target is a
  // phone number, not a new AI agent, and counting it would over-inflate the
  // chain for every A PASSER A L'HUMAIN outcome.
  const agentChain = { only1: 0, plus2: 0, plus3: 0 };
  if (rows.length > 0) {
    const callIds = rows.map((r) => r.id);
    const { data: evs } = await sb
      .from("call_events")
      .select("call_id, kind, payload")
      .in("call_id", callIds)
      .eq("kind", "handoff_initiated");
    const distinctByCall = new Map<string, Set<string>>();
    for (const r of rows) {
      const s = new Set<string>();
      if (r.agent_handle_id) s.add(r.agent_handle_id);
      distinctByCall.set(r.id, s);
    }
    for (const ev of (evs ?? []) as Array<{
      call_id: string;
      payload: { to_agent_id?: string; to?: string } | null;
    }>) {
      const target = ev.payload?.to_agent_id ?? ev.payload?.to;
      if (!target) continue;
      const s = distinctByCall.get(ev.call_id);
      if (s) s.add(target);
    }
    // Per call, the stage is the furthest agent reached — from structured
    // handoff events (Axon/native) OR the AI-detected metadata.agent_stage
    // (Retell, transcript-based). Whichever is higher wins; default 1.
    for (const r of rows) {
      const eventsN = distinctByCall.get(r.id)?.size ?? 0;
      const stageMeta = Number(r.metadata?.agent_stage) || 0;
      const n = Math.max(eventsN, stageMeta, 1);
      if (n >= 3) agentChain.plus3 += 1;
      else if (n === 2) agentChain.plus2 += 1;
      else agentChain.only1 += 1;
    }
  }

  // "What they said" — pick up to 30 most recent calls with a non-empty
  // summary, alongside their bucket. Client decides how to tab them.
  const summaries: SummaryRow[] = buckets
    .filter(({ row }) => row.summary && row.summary.trim().length > 0)
    .sort((a, b) =>
      (b.row.started_at ?? "").localeCompare(a.row.started_at ?? ""),
    )
    .slice(0, 80)
    .map(({ row, bucket }) => ({
      call_id: row.id,
      contact_name: row.contacts?.display_name ?? null,
      qualification: bucket,
      qualification_label:
        QUAL_BUCKETS.find((b) => b.key === bucket)?.label ?? bucket,
      agent_name: row.agent_handles?.display_name ?? null,
      duration: row.duration_secs ?? 0,
      started_at: row.started_at ?? "",
      summary: row.summary as string,
    }));

  // Dossiers à confier à un humain — open callback tasks.
  const { data: tasks } = await sb
    .from("human_callback_tasks")
    .select(
      "id, status, qualification, scheduled_for, contacts(display_name, e164)",
    )
    .eq("org_id", orgId)
    .in("status", ["pending", "in_progress"])
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .limit(50);
  const humanCallbacks: HumanCallbackRow[] = (
    (tasks ?? []) as unknown as Array<{
      id: string;
      status: string;
      qualification: string | null;
      scheduled_for: string | null;
      contacts: { display_name: string | null; e164: string | null } | null;
    }>
  ).map((t) => ({
    task_id: t.id,
    contact_name: t.contacts?.display_name ?? null,
    phone: t.contacts?.e164 ?? null,
    qualification: t.qualification,
    scheduled_for: t.scheduled_for,
    status: t.status,
  }));

  // Phases J1 / J3 / J5 — only meaningful when the tenant maintains a
  // phase-aware leads table (OCC: leads_rdv production, with leads_rdv_test_axon
  // as the dev sandbox kept alongside for safe testing). For orgs without it
  // we report zeros and a hint so the UI can label the section as N/A.
  const phases: DirectorResponse["phases"] = {
    rappel: { leads: 0, calls: 0, dueToday: 0, overdue: 0, upcoming: 0 },
    j1: { leads: 0, calls: 0, dueToday: 0, overdue: 0, upcoming: 0 },
    j3: { leads: 0, calls: 0, dueToday: 0, overdue: 0, upcoming: 0 },
    j5: { leads: 0, calls: 0, dueToday: 0, overdue: 0, upcoming: 0 },
  };
  // Today's UTC window, used to split each phase into overdue / due-today /
  // upcoming based on its scheduled call date.
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 86400_000);
  const classifyDate = (iso: string | null): "overdue" | "dueToday" | "upcoming" | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    if (d < todayStart) return "overdue";
    if (d < todayEnd) return "dueToday";
    return "upcoming";
  };
  let totalLeads = 0;
  let phasesAvailable = false;
  try {
    // OCC org has leads_rdv (production) and leads_rdv_test_axon (sandbox).
    // The leads_source query param picks which one to summarise — defaults
    // to prod, which is what the operator wants 99% of the time. Paged past
    // the 1000-row cap so phase counts cover the whole 7.5k-lead table.
    type Lead = {
      qualification: string | null;
      date_j1: string | null;
      date_j3: string | null;
      date_j5: string | null;
      j1_attempts: number | null;
      j3_attempts: number | null;
      j5_attempts: number | null;
    };
    const { rows: leads, error: leadsErr } = await fetchAllPaged<Lead>(() =>
      sb
        .from(leadsTable as never)
        .select(
          "qualification, date_j1, date_j3, date_j5, j1_attempts, j3_attempts, j5_attempts",
        ) as unknown as Rangeable<Lead>,
    );
    if (!leadsErr) {
      phasesAvailable = true;
      totalLeads = leads.length;
      const tally = (p: PhaseStat, date: string | null) => {
        const when = classifyDate(date);
        if (when) p[when] += 1;
      };
      for (const l of leads) {
        if ((l.qualification ?? "").toLowerCase().includes("rappel")) {
          phases.rappel.leads += 1;
          phases.rappel.calls += Number(l.j1_attempts ?? 0);
          tally(phases.rappel, l.date_j1);
        }
        if (l.date_j1) {
          phases.j1.leads += 1;
          phases.j1.calls += Number(l.j1_attempts ?? 0);
          tally(phases.j1, l.date_j1);
        }
        if (l.date_j3) {
          phases.j3.leads += 1;
          phases.j3.calls += Number(l.j3_attempts ?? 0);
          tally(phases.j3, l.date_j3);
        }
        if (l.date_j5) {
          phases.j5.leads += 1;
          phases.j5.calls += Number(l.j5_attempts ?? 0);
          tally(phases.j5, l.date_j5);
        }
      }
    }
  } catch {
    /* leads table absent for this tenant — phasesAvailable stays false */
  }

  const body: DirectorResponse = {
    kpis: {
      totalCalls: total,
      answered,
      answeredUniqueContacts,
      notAnswered,
      answeredPct: total ? (answered / total) * 100 : 0,
      cost,
      costByProvider,
      totalUniqueLeads,
      answeredUniqueLeads,
      rdvConfirmed,
      conversionRate: total ? (rdvConfirmed / total) * 100 : 0,
      avgDuration: answered ? Math.round(answeredDur / answered) : 0,
      callbacks,
      callsOverThreshold: over,
      threshold,
    },
    inbound,
    qualifications: QUAL_BUCKETS.filter((b) => b.key !== "autre").map((b) => ({
      key: b.key,
      label: b.label,
      count: qcount[b.key],
    })),
    qualificationsUnique: QUAL_BUCKETS.filter((b) => b.key !== "autre").map((b) => ({
      key: b.key,
      label: b.label,
      count: qcountUnique[b.key],
    })),
    unqualified: qcount.autre,
    pendingAnalysis: rows.filter((r) => {
      if (!r.answered_at || r.metadata?.analysis_skipped) return false;
      const needsQual = bucketForCall(r) === "autre";
      const needsStage = r.metadata?.agent_stage == null && (r.duration_secs ?? 0) >= 60;
      return needsQual || needsStage;
    }).length,
    slots,
    phases,
    phaseContext: {
      totalLeads,
      asOf: now.toISOString(),
      period: { from: from.toISOString(), to: to.toISOString() },
    },
    agentChain,
    durationBuckets,
    summaries,
    humanCallbacks,
    hints: {
      phasesAvailable,
      summariesAvailable: summaries.length > 0,
    },
  };
  return NextResponse.json(body);
}
