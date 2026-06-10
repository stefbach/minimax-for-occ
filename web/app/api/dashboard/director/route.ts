import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { bucketForCall, QUAL_BUCKETS, type QualBucket } from "@/lib/qualification";
import { isInbound, normalizeDirectionForDb } from "@/lib/call-direction";
import { callInLeadsScope, leadsTableFor, leadsScopeFor, type LeadsSource } from "@/lib/leads-source";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";
import { callMatchesSystem, parseCallSystem } from "@/lib/call-system";
import { isPhantomCall } from "@/lib/call-quality";
import { slotForDate } from "@/lib/call-slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vue d'ensemble — clones the OCC Retell exec summary as closely as the
// Axon schema allows. One endpoint computes every section so the client
// hits a single URL per period change.

const ACTIVE = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);

export type DirectorKpis = {
  totalCalls: number;
  answered: number;
  notAnswered: number;
  answeredPct: number;
  cost: number;
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
  const scope = await leadsScopeFor(leadsSource);

  const rows = ((data ?? []) as unknown as CallRow[]).filter(
    (r) =>
      !ACTIVE.has(r.state ?? "")
      && !isPhantomCall(r)
      && callInLeadsScope(r.to_e164 ?? null, scope)
      && callMatchesSystem((r.metadata as { source?: string } | null)?.source, system),
  );

  // KPIs
  const total = rows.length;
  const answered = rows.filter((r) => r.answered_at).length;
  const notAnswered = total - answered;
  const answeredDur = rows
    .filter((r) => r.answered_at)
    .reduce((a, r) => a + (r.duration_secs ?? 0), 0);
  const over = rows.filter((r) => (r.duration_secs ?? 0) > threshold).length;

  // Qualification bucketing — one pass.
  const qcount: Record<QualBucket, number> = {
    rdv_confirme: 0, passer_humain: 0, rappel: 0, pas_interesse: 0,
    pas_de_reponse: 0, repondeur: 0, faux_numero: 0, non_eligible: 0,
    ne_pas_rappeler: 0, autre: 0,
  };
  const buckets: { row: CallRow; bucket: QualBucket }[] = [];
  for (const r of rows) {
    const b = bucketForCall(r);
    qcount[b] += 1;
    buckets.push({ row: r, bucket: b });
  }

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
  const { rows: usage } = await fetchAllPaged<{ cost_cents: number; metadata: { call_id?: string } | null }>(
    () =>
      sb
        .from("usage_events")
        .select("cost_cents, metadata")
        .eq("org_id", orgId)
        .gte("occurred_at", from.toISOString())
        .lte("occurred_at", to.toISOString()) as unknown as Rangeable<{ cost_cents: number; metadata: { call_id?: string } | null }>,
  );
  const cost =
    usage
      .filter((u) => {
        const cid = u.metadata?.call_id;
        // Keep events with no call_id only when there is no filter active
        // (scope === null), otherwise we'd leak sandbox events back into
        // the prod view.
        if (!cid) return scope === null;
        return inScopeIds.has(cid);
      })
      .reduce((a, u) => a + (Number(u.cost_cents) || 0), 0) / 100;

  // Chaîne d'agents — count distinct agents touched per call from call_events.
  // Initial agent is calls.agent_handle_id (may be null for inbound). Handoffs
  // are logged with kind='handoff_initiated' and payload.to.
  const agentChain = { only1: 0, plus2: 0, plus3: 0 };
  if (rows.length > 0) {
    const callIds = rows.map((r) => r.id);
    const { data: evs } = await sb
      .from("call_events")
      .select("call_id, kind, payload")
      .in("call_id", callIds)
      .in("kind", ["handoff_initiated", "transfer_pstn_requested"]);
    const distinctByCall = new Map<string, Set<string>>();
    for (const r of rows) {
      const s = new Set<string>();
      if (r.agent_handle_id) s.add(r.agent_handle_id);
      distinctByCall.set(r.id, s);
    }
    for (const ev of (evs ?? []) as Array<{ call_id: string; payload: { to?: string } | null }>) {
      const target = ev.payload?.to;
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
      notAnswered,
      answeredPct: total ? (answered / total) * 100 : 0,
      cost: Math.round(cost * 100) / 100,
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
