import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { isInbound, isOutbound, normalizeDirectionForDb } from "@/lib/call-direction";
import { bucketForCall, QUAL_BUCKETS, type QualBucket } from "@/lib/qualification";
import { callBelongsToLeadsSource, leadsTableFor, phoneSetForLeadsSource, type LeadsSource } from "@/lib/leads-source";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";

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
export type HeatCell = { weekday: number; hour: number; count: number };
export type FunnelStep = { key: string; label: string; count: number; pct_of_total: number };
export type SourceRow = { source: string; total: number; rdv: number; conv_rate: number };
export type AnalyticsResponse = {
  from: string;
  to: string;
  granularity: "hour" | "day";
  kpis: AnalyticsKpis;
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
  const phoneSet = await phoneSetForLeadsSource(leadsSource);
  rows = rows.filter(
    (r) =>
      !ACTIVE_STATES.has(r.state ?? "")
      && (r.duration_secs ?? 0) >= minDuration
      && callBelongsToLeadsSource(r.to_e164 ?? null, phoneSet),
  );

  // ── KPIs ──
  const total = rows.length;
  const answered = rows.filter(isAnswered).length;
  const durSum = rows.reduce((a, r) => a + (r.duration_secs ?? 0), 0);
  const answeredDurSum = rows.filter(isAnswered).reduce((a, r) => a + (r.duration_secs ?? 0), 0);
  const inbound = rows.filter((r) => isInbound(r.direction)).length;
  const outbound = rows.filter((r) => isOutbound(r.direction)).length;

  // Real cost from recorded usage (telephony minutes + LLM tokens + TTS chars +
  // STT minutes), summed over the period and restricted to in-scope calls.
  const inScopeIds = new Set(rows.map((r) => r.id));
  const { data: usage } = await sb
    .from("usage_events")
    .select("event_type, cost_cents, metadata")
    .eq("org_id", orgId)
    .gte("occurred_at", from.toISOString())
    .lte("occurred_at", to.toISOString());
  const breakdown = { call_minutes: 0, llm_tokens: 0, tts_chars: 0, stt_minutes: 0 };
  let totalCents = 0;
  for (const u of (usage ?? [])) {
    const cid = (u as { metadata?: { call_id?: string } | null }).metadata?.call_id;
    // Drop events that belong to filtered-out calls. Untagged events
    // (no call_id) only count when no filter is active.
    if (cid ? !inScopeIds.has(cid) : phoneSet !== null) continue;
    const cents = Number((u as { cost_cents: number }).cost_cents) || 0;
    totalCents += cents;
    const k = (u as { event_type: string }).event_type as keyof typeof breakdown;
    if (k in breakdown) breakdown[k] += cents;
  }
  const costReal = Math.round((totalCents / 100) * 100) / 100; // → dollars, 2dp
  const r2 = (cents: number) => Math.round((cents / 100) * 100) / 100;

  const kpis: AnalyticsKpis = {
    total,
    answered,
    answer_rate: total ? answered / total : 0,
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

  // ── Heatmap (weekday 0-6 × hour 0-23), local time ──
  const heatMap = new Map<string, number>();
  for (const r of rows) {
    if (!r.started_at) continue;
    const d = new Date(r.started_at);
    const key = `${d.getDay()}_${d.getHours()}`;
    heatMap.set(key, (heatMap.get(key) ?? 0) + 1);
  }
  const heatmap: HeatCell[] = Array.from(heatMap.entries()).map(([k, count]) => {
    const [weekday, hour] = k.split("_").map(Number);
    return { weekday, hour, count };
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
    ne_pas_rappeler: 0, autre: 0,
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
  try {
    type LeadRow = { numero_telephone: string | null; source_lead: string | null };
    // Page past the 1000-row cap so source attribution sees every lead.
    const { rows: leads, error: leadsErr } = await fetchAllPaged<LeadRow>(() =>
      sb
        .from(leadsTable as never)
        .select("numero_telephone, source_lead")
        .not("numero_telephone", "is", null) as unknown as Rangeable<LeadRow>,
    );
    if (!leadsErr) {
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
  } catch {
    /* tenant doesn't have a leads table — empty sources is fine */
  }

  // ── Cost per RDV — a business metric, not just a vanity dashboard number.
  //    Uses real recorded cost where available, falls back to the rate
  //    estimate so something meaningful renders even before usage_events
  //    catch up.
  const totalSpent = costReal > 0 ? costReal : kpis.cost_estimate;
  const cost_per_rdv = rdvBooked > 0 ? Math.round((totalSpent / rdvBooked) * 100) / 100 : 0;

  const body: AnalyticsResponse = {
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
    kpis,
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
