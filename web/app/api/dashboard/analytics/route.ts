import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { isInbound, isOutbound, normalizeDirectionForDb } from "@/lib/call-direction";
import { bucketForCall, QUAL_BUCKETS, type QualBucket } from "@/lib/qualification";
import { callInLeadsScope, campaignScopeFor, leadsTableFor, leadsScopeFor, type LeadsSource } from "@/lib/leads-source";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";
import { callMatchesSystem, parseCallSystem } from "@/lib/call-system";
import { slotForDate, SLOT_WINDOWS } from "@/lib/call-slots";
import { isPhantomCall, isSoftphoneTestLeg } from "@/lib/call-quality";
import {
  parseGlobalFilters, hasActiveGlobalFilters, matchesGlobalFilters,
  buildLeadFilterIndex, buildAttemptIndex, eligibilityForPhone, EMPTY_LEAD_INDEX,
} from "@/lib/global-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generic call analytics over an arbitrary period, computed from the org's
// `calls` table (multi-tenant safe). No OCC-specific logic. Aggregations are
// done in Node over the fetched rows (capped) — fine at current scale; can be
// pushed into SQL RPCs later if volumes grow.

const ACTIVE_STATES = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);
// Rough blended per-minute cost estimate (LiveKit + Twilio + LLM/TTS). Used for
// the "Coût estimé" tile only; clearly labelled as an estimate in the UI.
const COST_PER_MIN = Number(process.env.CALL_COST_PER_MIN ?? 0.12);
const ROW_CAP = 8000;

export type AnalyticsKpis = {
  total: number;
  answered: number;
  answer_rate: number;
  rdv_confirmed: number;     // distinct-ish RDV (rdv_confirme + passer_humain), like the funnel
  conversion_rate: number;   // rdv_confirmed / total
  avg_duration_secs: number;
  abandon_rate: number;
  inbound: number;
  outbound: number;
  cost_estimate: number;   // fallback: duration × rate, used only if no usage events
  cost_per_min: number;
  cost_real: number;       // real cost (USD) from recorded usage_events over the period
  cost_is_real: boolean;   // true when usage_events exist for the period
  cost_breakdown: { call_minutes: number; llm_tokens: number; tts_chars: number; stt_minutes: number };
};

export type Bucket = { key: string; count: number };
export type AgentPerf = {
  agent: string;
  total: number;
  answered: number;
  answer_rate: number;
  avg_duration_secs: number;
};
export type HeatCell = { weekday: number; hour: number; count: number; answered: number; rdv: number };
export type FunnelStep = { key: string; label: string; count: number; pct_of_total: number };
export type SourceRow = { source: string; total: number; rdv: number; conv_rate: number };
// Cost panel — spend broken down by outcome and by hour, plus the headline tiles.
export type CostPanel = {
  total: number;
  avg_per_call: number;
  cost_per_rdv: number;
  wasted: number;       // spend on faux_numero + pas_de_reponse
  wasted_pct: number;
  by_outcome: { key: QualBucket; label: string; cost: number }[];
  by_hour: { hour: number; cost: number }[];
};
export type SlotRow = { key: "matin" | "midi" | "soir" | "hors"; label: string; total: number; answered: number };
// Eligibility pipeline (S2 UK NHS WMP) — eligible leads still callable vs lost.
export type EligLead = { name: string | null; phone: string | null; bmi: number; status: string; calls: number; source: string };
export type Eligibility = {
  total_leads: number;
  eligible_total: number;
  pipeline_count: number;
  in_pipeline: EligLead[];
  lost_count: number;
  lost_sample: { name: string | null; bmi: number; reason: string }[];
};
// Same-length previous period, for "vs prev" deltas on the KPI tiles.
export type PreviousPeriod = { total: number; answered: number; cost: number; rdv: number };
// Lead-pipeline metrics (forward-looking, from the leads table — not the period).
export type BusinessMetrics = {
  eligible_in_pipeline: number; // BMI ≥ 40 and not yet RDV
  avg_calls_before_rdv: number; // mean call_count over booked leads
  total_leads: number;
  wrong_num: number;            // faux_numero + pas_de_reponse in the period
  active_calls: number;         // live calls right now (in-scope)
};
export type AnalyticsResponse = {
  from: string;
  to: string;
  granularity: "hour" | "day";
  kpis: AnalyticsKpis;
  previous: PreviousPeriod;
  business: BusinessMetrics;
  cost_panel: CostPanel;
  slots: SlotRow[];
  eligibility: Eligibility;
  volume: Bucket[];
  dispositions: Bucket[];
  qualifications: { key: QualBucket; label: string; count: number }[];
  funnel: FunnelStep[];
  sources: SourceRow[];
  agents: AgentPerf[];
  heatmap: HeatCell[];
  duration_histogram: Bucket[];
  attempt_funnel: { attempt: number; total: number; answered: number }[];
  cost_per_rdv: number; // €/USD per confirmed RDV (0 if no RDV)
  truncated: boolean;
};

type CallRow = {
  id: string;
  direction: string | null;
  state: string | null;
  started_at: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  contact_id: string | null;
  to_e164: string | null;
  metadata: { qualification?: string | null } | null;
  agent_handles: { display_name: string | null } | null;
};

function isAnswered(r: CallRow): boolean {
  // Answered = the callee picked up. answered_at is the strongest signal;
  // fall back to a non-failed ended call with a duration.
  if (r.answered_at) return true;
  return r.state === "ended" && (r.duration_secs ?? 0) > 0;
}

const DURATION_BUCKETS: { key: string; max: number }[] = [
  { key: "0–10s", max: 10 },
  { key: "10–30s", max: 30 },
  { key: "30–60s", max: 60 },
  { key: "1–3min", max: 180 },
  { key: "3–5min", max: 300 },
  { key: "5min+", max: Infinity },
];

export async function GET(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const orgId = await requestOrgId(request);
  const { searchParams } = new URL(request.url);

  const now = new Date();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const to = toParam ? new Date(toParam) : now;
  const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 7 * 86400_000);
  const direction = searchParams.get("direction"); // inbound | outbound | null
  const minDuration = Number(searchParams.get("min_duration") ?? 0);
  const leadsSource: LeadsSource = searchParams.get("leads_source") === "test" ? "test" : "prod";
  const leadsTable = leadsTableFor(leadsSource);
  const system = parseCallSystem(searchParams.get("system"));
  const campaignId = searchParams.get("campaign_id");
  // Global filter-bar constraints (durée / qualification / source / agent /
  // tentative / éligibilité / décroché / recherche). All-pass when absent.
  const gf = parseGlobalFilters((k) => searchParams.get(k));

  const rangeMs = to.getTime() - from.getTime();
  const granularity: "hour" | "day" = rangeMs <= 2 * 86400_000 ? "hour" : "day";

  const sb = supabaseServer();
  const dbDirection = normalizeDirectionForDb(direction);
  // Paged past the 1000-row PostgREST cap; bounded at ROW_CAP+1 so we can still
  // flag truncation for very large periods without scanning the whole table.
  const { rows: data, error } = await fetchAllPaged<any>(
    () => {
      let q = sb
        .from("calls")
        .select(
          "id, direction, state, started_at, answered_at, duration_secs, disposition, contact_id, to_e164, metadata, agent_handles(display_name)",
        )
        .eq("org_id", orgId)
        .gte("started_at", from.toISOString())
        .lte("started_at", to.toISOString())
        .order("started_at", { ascending: true });
      if (dbDirection) q = q.eq("direction", dbDirection);
      return q as unknown as Rangeable<any>;
    },
    { maxRows: ROW_CAP + 1000 },
  );
  if (error) return NextResponse.json({ error }, { status: 500 });

  // Supabase types the joined relation as an array; flatten to a single object.
  let rows: CallRow[] = (data ?? []).map((r: any) => ({
    ...r,
    agent_handles: Array.isArray(r.agent_handles) ? r.agent_handles[0] ?? null : r.agent_handles ?? null,
  }));
  const truncated = rows.length > ROW_CAP;
  if (truncated) rows = rows.slice(0, ROW_CAP);
  // Same leads-source scoping as Vue d'ensemble: when the operator picked
  // Prod we want to count only calls placed to leads_rdv numbers, ditto
  // Test → leads_rdv_test_axon.
  const [scope, campaignScope] = await Promise.all([
    leadsScopeFor(leadsSource),
    campaignId && campaignId !== "all" ? campaignScopeFor(campaignId) : Promise.resolve(null),
  ]);
  const inScope = (r: CallRow) =>
    callInLeadsScope(r.to_e164 ?? null, scope)
    && callInLeadsScope(r.to_e164 ?? null, campaignScope)
    && callMatchesSystem((r.metadata as { source?: string } | null)?.source, system);
  // Live calls right now (in-scope) — captured before we drop ACTIVE rows.
  const activeCalls = (rows as CallRow[]).filter((r) => ACTIVE_STATES.has(r.state ?? "") && inScope(r)).length;
  rows = rows.filter(
    (r) =>
      !ACTIVE_STATES.has(r.state ?? "")
      && !isPhantomCall(r)
      && !isSoftphoneTestLeg(r)
      && (r.duration_secs ?? 0) >= minDuration
      && inScope(r),
  );

  // Leads table (when the tenant has one) — fetched up-front because both the
  // global filters (éligibilité / source / recherche par nom) and the
  // source-attribution + eligibility sections below need it.
  type LeadRow = { nom: string | null; numero_telephone: string | null; source_lead: string | null; bmi: number | null; qualification: string | null; call_count: number | null };
  let leadRows: LeadRow[] = [];
  let leadsOk = false;
  try {
    // Page past the 1000-row cap so source attribution sees every lead.
    const { rows: leads, error: leadsErr } = await fetchAllPaged<LeadRow>(() =>
      sb
        .from(leadsTable as never)
        .select("nom, numero_telephone, source_lead, bmi, qualification, call_count")
        .not("numero_telephone", "is", null) as unknown as Rangeable<LeadRow>,
    );
    if (!leadsErr) {
      leadRows = leads;
      leadsOk = true;
    }
  } catch {
    /* tenant doesn't have a leads table — lead-scoped filters become no-match "unknown" */
  }
  const leadIdx = leadsOk ? buildLeadFilterIndex(leadRows) : EMPTY_LEAD_INDEX;

  // Global filter bar — applied before every aggregation so each KPI, chart
  // and panel reflects exactly the operator's selection.
  if (hasActiveGlobalFilters(gf)) {
    const attemptIdx = buildAttemptIndex(rows);
    rows = rows.filter((r) =>
      matchesGlobalFilters(gf, {
        durationSecs: r.duration_secs ?? 0,
        bucket: bucketForCall(r),
        agent: r.agent_handles?.display_name ?? null,
        answered: isAnswered(r),
        attempt: r.to_e164 ? attemptIdx.get(r.id) ?? null : null,
        eligibility: eligibilityForPhone(r.to_e164, leadIdx),
        source: (r.to_e164 && leadIdx.sourceByPhone.get(r.to_e164)) || null,
        haystack: `${(r.to_e164 && leadIdx.nameByPhone.get(r.to_e164)) ?? ""} ${r.to_e164 ?? ""}`.toLowerCase(),
      }),
    );
  }

  // RDV = the booked outcome (matches the funnel / Vue d'ensemble definition).
  const isRdv = (r: CallRow) => {
    const b = bucketForCall(r);
    return b === "rdv_confirme" || b === "passer_humain";
  };

  // ── KPIs ──
  const total = rows.length;
  const answered = rows.filter(isAnswered).length;
  const rdvCount = rows.filter(isRdv).length;
  const durSum = rows.reduce((a, r) => a + (r.duration_secs ?? 0), 0);
  const answeredDurSum = rows.filter(isAnswered).reduce((a, r) => a + (r.duration_secs ?? 0), 0);
  const inbound = rows.filter((r) => isInbound(r.direction)).length;
  const outbound = rows.filter((r) => isOutbound(r.direction)).length;

  // Real cost from recorded usage (telephony minutes + LLM tokens + TTS chars +
  // STT minutes), summed over the period and restricted to in-scope calls.
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
  const breakdown = { call_minutes: 0, llm_tokens: 0, tts_chars: 0, stt_minutes: 0 };
  let totalCents = 0;
  const costByCall = new Map<string, number>(); // call_id → cents, for the cost panel
  for (const u of usage) {
    const cid = u.metadata?.call_id;
    // Drop events that belong to filtered-out calls. Untagged events
    // (no call_id) only count when no filter is active.
    if (cid ? !inScopeIds.has(cid) : scope !== null) continue;
    const cents = Number(u.cost_cents) || 0;
    totalCents += cents;
    if (cid) costByCall.set(cid, (costByCall.get(cid) ?? 0) + cents);
    const k = u.event_type as keyof typeof breakdown;
    if (k in breakdown) breakdown[k] += cents;
  }
  const costReal = Math.round((totalCents / 100) * 100) / 100; // → dollars, 2dp
  const r2 = (cents: number) => Math.round((cents / 100) * 100) / 100;

  const kpis: AnalyticsKpis = {
    total,
    answered,
    answer_rate: total ? answered / total : 0,
    rdv_confirmed: rdvCount,
    conversion_rate: total ? rdvCount / total : 0,
    avg_duration_secs: answered ? Math.round(answeredDurSum / answered) : 0,
    abandon_rate: total ? (total - answered) / total : 0,
    inbound,
    outbound,
    cost_estimate: Math.round((durSum / 60) * COST_PER_MIN * 100) / 100,
    cost_per_min: COST_PER_MIN,
    cost_real: costReal,
    cost_is_real: (usage ?? []).length > 0,
    cost_breakdown: {
      call_minutes: r2(breakdown.call_minutes),
      llm_tokens: r2(breakdown.llm_tokens),
      tts_chars: r2(breakdown.tts_chars),
      stt_minutes: r2(breakdown.stt_minutes),
    },
  };

  // ── Volume buckets ──
  const volMap = new Map<string, number>();
  for (const r of rows) {
    if (!r.started_at) continue;
    const d = new Date(r.started_at);
    const key =
      granularity === "hour"
        ? `${d.toISOString().slice(0, 13)}:00`
        : d.toISOString().slice(0, 10);
    volMap.set(key, (volMap.get(key) ?? 0) + 1);
  }
  const volume: Bucket[] = Array.from(volMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));

  // ── Dispositions ──
  const dispMap = new Map<string, number>();
  for (const r of rows) {
    const k = r.disposition || r.state || "—";
    dispMap.set(k, (dispMap.get(k) ?? 0) + 1);
  }
  const dispositions: Bucket[] = Array.from(dispMap.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  // ── Agent performance ──
  const agentMap = new Map<string, { total: number; answered: number; dur: number }>();
  for (const r of rows) {
    const name = r.agent_handles?.display_name || "—";
    const a = agentMap.get(name) ?? { total: 0, answered: 0, dur: 0 };
    a.total += 1;
    if (isAnswered(r)) {
      a.answered += 1;
      a.dur += r.duration_secs ?? 0;
    }
    agentMap.set(name, a);
  }
  const agents: AgentPerf[] = Array.from(agentMap.entries())
    .map(([agent, a]) => ({
      agent,
      total: a.total,
      answered: a.answered,
      answer_rate: a.total ? a.answered / a.total : 0,
      avg_duration_secs: a.answered ? Math.round(a.dur / a.answered) : 0,
    }))
    .sort((x, y) => y.total - x.total);

  // ── Heatmap (weekday 0-6 × hour 0-23), local time ── now carries answered +
  // RDV per slot so the UI can show answer-rate AND RDV-rate ("when to call").
  const heatMap = new Map<string, { count: number; answered: number; rdv: number }>();
  for (const r of rows) {
    if (!r.started_at) continue;
    const d = new Date(r.started_at);
    const key = `${d.getDay()}_${d.getHours()}`;
    const c = heatMap.get(key) ?? { count: 0, answered: 0, rdv: 0 };
    c.count += 1;
    if (isAnswered(r)) c.answered += 1;
    if (isRdv(r)) c.rdv += 1;
    heatMap.set(key, c);
  }
  const heatmap: HeatCell[] = Array.from(heatMap.entries()).map(([k, c]) => {
    const [weekday, hour] = k.split("_").map(Number);
    return { weekday, hour, count: c.count, answered: c.answered, rdv: c.rdv };
  });

  // ── Duration histogram ──
  const histCounts = new Array(DURATION_BUCKETS.length).fill(0);
  for (const r of rows) {
    const s = r.duration_secs ?? 0;
    const idx = DURATION_BUCKETS.findIndex((b) => s <= b.max);
    histCounts[idx >= 0 ? idx : DURATION_BUCKETS.length - 1] += 1;
  }
  const duration_histogram: Bucket[] = DURATION_BUCKETS.map((b, i) => ({
    key: b.key,
    count: histCounts[i],
  }));

  // ── Attempt funnel: nth call to a given contact within the period ──
  const byContact = new Map<string, CallRow[]>();
  for (const r of rows) {
    if (!r.contact_id) continue;
    (byContact.get(r.contact_id) ?? byContact.set(r.contact_id, []).get(r.contact_id)!).push(r);
  }
  const attemptAgg = new Map<number, { total: number; answered: number }>();
  for (const calls of byContact.values()) {
    calls.sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
    calls.forEach((r, i) => {
      const attempt = Math.min(i + 1, 5); // cap at "5+"
      const agg = attemptAgg.get(attempt) ?? { total: 0, answered: 0 };
      agg.total += 1;
      if (isAnswered(r)) agg.answered += 1;
      attemptAgg.set(attempt, agg);
    });
  }
  const attempt_funnel = Array.from(attemptAgg.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([attempt, v]) => ({ attempt, total: v.total, answered: v.answered }));

  // ── Qualifications (9 fixed buckets) — replaces the raw "dispositions" list
  //    that was showing internal states like stale_no_terminal_event.
  const qcount: Record<QualBucket, number> = {
    rdv_confirme: 0, passer_humain: 0, rappel: 0, pas_interesse: 0,
    pas_de_reponse: 0, repondeur: 0, faux_numero: 0, non_eligible: 0,
    ne_pas_rappeler: 0, suivi_requis: 0, autre: 0,
  };
  for (const r of rows) qcount[bucketForCall(r)] += 1;
  const qualifications = QUAL_BUCKETS.filter((b) => b.key !== "autre").map((b) => ({
    key: b.key, label: b.label, count: qcount[b.key],
  }));

  // ── Conversion funnel ───────────────────────────────────────────────
  // Models the same 4-step funnel as the OCC reference:
  //   Total appels (initiés) → Décrochés → Conversation >60s → RDV booked
  // Each step's percentage is computed against the previous step so the
  // drop-off between stages is visible at a glance.
  const conversationOver60 = rows.filter(
    (r) => (r.duration_secs ?? 0) > 60 && isAnswered(r),
  ).length;
  const rdvBooked = qcount.rdv_confirme + qcount.passer_humain;
  const funnel: FunnelStep[] = [
    { key: "total", label: "Appels initiés", count: total, pct_of_total: 1 },
    {
      key: "answered",
      label: "Décrochés",
      count: answered,
      pct_of_total: total ? answered / total : 0,
    },
    {
      key: "conversation",
      label: "Conversation > 60s",
      count: conversationOver60,
      pct_of_total: total ? conversationOver60 / total : 0,
    },
    {
      key: "rdv",
      label: "RDV obtenu",
      count: rdvBooked,
      pct_of_total: total ? rdvBooked / total : 0,
    },
  ];

  // ── Lead source attribution ─────────────────────────────────────────
  // Reads source_lead from the tenant's production leads table when one
  // exists (OCC's leads_rdv ships with this column; other orgs get an empty
  // list, which the UI hides). Joined on phone number to call rows so we
  // can compute per-source conversion.
  let sources: SourceRow[] = [];
  const business: BusinessMetrics = {
    eligible_in_pipeline: 0,
    avg_calls_before_rdv: 0,
    total_leads: 0,
    wrong_num: qcount.faux_numero + qcount.pas_de_reponse,
    active_calls: activeCalls,
  };
  const eligibility: Eligibility = {
    total_leads: 0, eligible_total: 0, pipeline_count: 0,
    in_pipeline: [], lost_count: 0, lost_sample: [],
  };
  {
    // Reuses the leads fetched up-front (before the global filters).
    const leads = leadRows;
    if (leadsOk) {
      // Lead-pipeline metrics (forward-looking; not bounded by the period).
      let bookedLeads = 0;
      let bookedCalls = 0;
      const pipelineRows: EligLead[] = [];
      const lostRows: { name: string | null; bmi: number; reason: string }[] = [];
      for (const l of leads) {
        business.total_leads += 1;
        const qual = (l.qualification ?? "").trim();
        const ql = qual.toLowerCase();
        const isBooked = ql.includes("rdv");
        const isLost = ql.includes("faux") || ql.includes("interess");
        const bmi = Number(l.bmi);
        const eligible = Number.isFinite(bmi) && bmi >= 40; // S2: BMI ≥ 40 (comorbidity path needs structured data)
        if (eligible && !isBooked) business.eligible_in_pipeline += 1;
        if (isBooked) { bookedLeads += 1; bookedCalls += Number(l.call_count) || 0; }
        // Eligibility pipeline detail.
        if (eligible) {
          eligibility.eligible_total += 1;
          if (isBooked) {
            /* converted — out of pipeline */
          } else if (isLost) {
            eligibility.lost_count += 1;
            if (lostRows.length < 10) lostRows.push({ name: l.nom, bmi, reason: qual || "—" });
          } else {
            eligibility.pipeline_count += 1;
            pipelineRows.push({
              name: l.nom, phone: l.numero_telephone, bmi,
              status: qual || "—", calls: Number(l.call_count) || 0,
              source: (l.source_lead || "—").trim(),
            });
          }
        }
      }
      eligibility.total_leads = business.total_leads;
      eligibility.in_pipeline = pipelineRows.sort((a, b) => b.bmi - a.bmi).slice(0, 50);
      eligibility.lost_sample = lostRows;
      business.avg_calls_before_rdv = bookedLeads > 0 ? Math.round((bookedCalls / bookedLeads) * 10) / 10 : 0;
      const sourceByPhone = new Map<string, string>();
      for (const l of leads) {
        if (l.numero_telephone) {
          sourceByPhone.set(l.numero_telephone, (l.source_lead || "Inconnue").trim());
        }
      }
      {
        // rows already carry to_e164, so no extra (1000-capped) re-fetch.
        const acc = new Map<string, { total: number; rdv: number }>();
        for (const r of rows) {
          const phone = r.to_e164;
          if (!phone) continue;
          const src = sourceByPhone.get(phone) ?? "Inconnue";
          const s = acc.get(src) ?? { total: 0, rdv: 0 };
          s.total += 1;
          const b = bucketForCall(r);
          if (b === "rdv_confirme" || b === "passer_humain") s.rdv += 1;
          acc.set(src, s);
        }
        sources = Array.from(acc.entries())
          .map(([source, s]) => ({
            source,
            total: s.total,
            rdv: s.rdv,
            conv_rate: s.total ? s.rdv / s.total : 0,
          }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 12);
      }
    }
  }

  // ── Cost per RDV — a business metric, not just a vanity dashboard number.
  //    Uses real recorded cost where available, falls back to the rate
  //    estimate so something meaningful renders even before usage_events
  //    catch up.
  const totalSpent = costReal > 0 ? costReal : kpis.cost_estimate;
  const cost_per_rdv = rdvBooked > 0 ? Math.round((totalSpent / rdvBooked) * 100) / 100 : 0;

  // ── Cost panel: spend by outcome + by hour, plus headline tiles ──
  const d2 = (cents: number) => Math.round(cents) / 100;
  const outCost = new Map<QualBucket, number>();
  const hourCost = new Array<number>(24).fill(0);
  let wastedCents = 0;
  for (const r of rows) {
    const c = costByCall.get(r.id) ?? 0;
    const b = bucketForCall(r);
    outCost.set(b, (outCost.get(b) ?? 0) + c);
    if (r.started_at) hourCost[new Date(r.started_at).getHours()] += c;
    if (b === "faux_numero" || b === "pas_de_reponse") wastedCents += c;
  }
  const cost_panel: CostPanel = {
    total: costReal,
    avg_per_call: total > 0 ? Math.round(totalCents / total) / 100 : 0,
    cost_per_rdv,
    wasted: d2(wastedCents),
    wasted_pct: totalCents > 0 ? wastedCents / totalCents : 0,
    by_outcome: QUAL_BUCKETS
      .map((b) => ({ key: b.key, label: b.label, cost: d2(outCost.get(b.key) ?? 0) }))
      .filter((x) => x.cost > 0)
      .sort((a, b) => b.cost - a.cost),
    by_hour: hourCost.map((c, h) => ({ hour: h, cost: d2(c) })),
  };

  // ── Volume per OCC call-slot (Matin / Midi / Soir / Hors), with answer rate ──
  const slotAgg: Record<"matin" | "midi" | "soir" | "hors", { total: number; answered: number }> = {
    matin: { total: 0, answered: 0 }, midi: { total: 0, answered: 0 },
    soir: { total: 0, answered: 0 }, hors: { total: 0, answered: 0 },
  };
  for (const r of rows) {
    if (!r.started_at) continue;
    const s = slotForDate(new Date(r.started_at));
    slotAgg[s].total += 1;
    if (isAnswered(r)) slotAgg[s].answered += 1;
  }
  const slotLabel: Record<"matin" | "midi" | "soir" | "hors", string> = {
    matin: `Matin (${SLOT_WINDOWS.matin.uk})`,
    midi: `Midi (${SLOT_WINDOWS.midi.uk})`,
    soir: `Soir (${SLOT_WINDOWS.soir.uk})`,
    hors: "Hors créneau",
  };
  const slots: SlotRow[] = (["matin", "midi", "soir", "hors"] as const).map((key) => ({
    key, label: slotLabel[key], total: slotAgg[key].total, answered: slotAgg[key].answered,
  }));

  // ── Previous equivalent period (same span, immediately before) for deltas ──
  const span = Math.max(0, to.getTime() - from.getTime());
  const previous: PreviousPeriod = { total: 0, answered: 0, cost: 0, rdv: 0 };
  if (span > 0) {
    const prevFrom = new Date(from.getTime() - span);
    const prevTo = from;
    const { rows: prevData } = await fetchAllPaged<CallRow>(() => {
      let q = sb
        .from("calls")
        .select("id, direction, state, started_at, answered_at, duration_secs, disposition, to_e164, metadata, agent_handles(display_name)")
        .eq("org_id", orgId)
        .gte("started_at", prevFrom.toISOString())
        .lt("started_at", prevTo.toISOString());
      if (dbDirection) q = q.eq("direction", dbDirection);
      return q as unknown as Rangeable<CallRow>;
    }, { maxRows: ROW_CAP + 1000 });
    let prevRows = (prevData ?? [])
      .map((r: any) => ({
        ...r,
        agent_handles: Array.isArray(r.agent_handles) ? r.agent_handles[0] ?? null : r.agent_handles ?? null,
      }))
      .filter(
        (r: CallRow) => !ACTIVE_STATES.has(r.state ?? "") && !isPhantomCall(r) && !isSoftphoneTestLeg(r) && (r.duration_secs ?? 0) >= minDuration && inScope(r),
      );
    // Same global filters as the current period, so the "vs précédent"
    // deltas compare like with like.
    if (hasActiveGlobalFilters(gf)) {
      const prevAttemptIdx = buildAttemptIndex(prevRows);
      prevRows = prevRows.filter((r: CallRow) =>
        matchesGlobalFilters(gf, {
          durationSecs: r.duration_secs ?? 0,
          bucket: bucketForCall(r),
          agent: r.agent_handles?.display_name ?? null,
          answered: isAnswered(r),
          attempt: r.to_e164 ? prevAttemptIdx.get(r.id) ?? null : null,
          eligibility: eligibilityForPhone(r.to_e164, leadIdx),
          source: (r.to_e164 && leadIdx.sourceByPhone.get(r.to_e164)) || null,
          haystack: `${(r.to_e164 && leadIdx.nameByPhone.get(r.to_e164)) ?? ""} ${r.to_e164 ?? ""}`.toLowerCase(),
        }),
      );
    }
    const prevIds = new Set(prevRows.map((r) => r.id));
    previous.total = prevRows.length;
    previous.answered = prevRows.filter(isAnswered).length;
    previous.rdv = prevRows.filter(isRdv).length;
    const { rows: prevUsage } = await fetchAllPaged<{ cost_cents: number; metadata: { call_id?: string } | null }>(() =>
      sb
        .from("usage_events")
        .select("cost_cents, metadata")
        .eq("org_id", orgId)
        .gte("occurred_at", prevFrom.toISOString())
        .lt("occurred_at", prevTo.toISOString()) as unknown as Rangeable<{ cost_cents: number; metadata: { call_id?: string } | null }>,
    );
    let prevCents = 0;
    for (const u of prevUsage) {
      const cid = u.metadata?.call_id;
      if (cid ? !prevIds.has(cid) : scope !== null) continue;
      prevCents += Number(u.cost_cents) || 0;
    }
    previous.cost = Math.round(prevCents) / 100;
  }

  const body: AnalyticsResponse = {
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
    kpis,
    previous,
    business,
    cost_panel,
    slots,
    eligibility,
    volume,
    dispositions,
    qualifications,
    funnel,
    sources,
    agents,
    heatmap,
    duration_histogram,
    attempt_funnel,
    cost_per_rdv,
    truncated,
  };
  return NextResponse.json(body);
}
