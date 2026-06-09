import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { callInLeadsScope, leadsScopeFor, leadsTableFor, type LeadsSource } from "@/lib/leads-source";
import { callMatchesSystem, parseCallSystem } from "@/lib/call-system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const VALID_STATES = new Set([
  "queued",
  "ringing",
  "ivr",
  "in_progress",
  "wrap_up",
  "ended",
  "failed",
]);

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json([]);

  const { searchParams } = new URL(request.url);
  const orgId = await requestOrgId(request);
  const stateParam = searchParams.get("state");
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 250);

  const states = stateParam
    ? stateParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => VALID_STATES.has(s))
    : [];

  const admin = supabaseServer();

  // Opportunistic sweep: any call left in an active state for > 5 min without
  // a terminal event is almost certainly orphaned (LiveKit room died, TTS quota
  // hit, worker crashed, etc.). Mark them failed so the "Appels actifs" panel
  // doesn't show ghosts at 11:44+ minutes. Cheap UPDATE — runs each list view.
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await admin
      .from("calls")
      .update({
        state: "failed",
        ended_at: new Date().toISOString(),
        disposition: "stale_no_terminal_event",
      })
      .eq("org_id", orgId)
      .in("state", ["queued", "ringing", "ivr", "in_progress", "wrap_up"])
      .lt("started_at", cutoff);
  } catch {
    /* sweep is best-effort — don't fail the list query if it errors */
  }

  let q = admin
    .from("calls")
    .select(
      "id, org_id, direction, state, from_e164, to_e164, room_id, started_at, answered_at, ended_at, duration_secs, disposition, recording_url, transcript_url, agent_handle_id, contact_id, metadata, agent_handles(id, display_name, kind), contacts(id, e164, display_name)",
    )
    .eq("org_id", orgId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (states.length > 0) {
    q = q.in("state", states);
  }

  // Optional period + direction filters (dashboard Call Logs tab).
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from) q = q.gte("started_at", from);
  if (to) q = q.lte("started_at", to);
  const dir = searchParams.get("direction");
  if (dir === "inbound" || dir === "in") q = q.eq("direction", "in");
  else if (dir === "outbound" || dir === "out") q = q.eq("direction", "out");

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Same leads-source scoping the dashboard director / analytics use, so
  // Call Logs and the Live monitor only show calls placed to leads from
  // the operator's selected table.
  const leadsParam = searchParams.get("leads_source");
  const leadsSource: LeadsSource | null =
    leadsParam === "test" ? "test" : leadsParam === "prod" ? "prod" : null;
  const scope = leadsSource ? await leadsScopeFor(leadsSource) : null;
  const system = parseCallSystem(searchParams.get("system"));

  const calls = ((data ?? []) as Array<{ id: string; started_at: string | null; to_e164: string | null; metadata: { source?: string } | null }>)
    .filter((c) => callInLeadsScope(c.to_e164 ?? null, scope))
    .filter((c) => callMatchesSystem(c.metadata?.source, system));

  // Attach real cost per call (sum of usage_events whose metadata.call_id
  // matches). One aggregate query covers the whole list — cheap enough at
  // ≤ 250 calls; bypass the join if there's nothing to enrich.
  let costByCall = new Map<string, number>();
  if (calls.length > 0) {
    const ids = calls.map((c) => c.id);
    try {
      // Compute time window from the displayed calls so we don't scan the
      // whole table — narrowed to the period filter when present.
      const oldest = calls.reduce<string | null>((m, c) => {
        if (!c.started_at) return m;
        return !m || c.started_at < m ? c.started_at : m;
      }, null);
      // Hard floor the lookback to 3 days when there's no explicit `from`, so a
      // single stray/ghost call with an old started_at can't widen the
      // usage_events scan to weeks and time the whole request out (which is
      // exactly what froze the Live monitor: "Failed to fetch").
      const floorIso = new Date(Date.now() - 3 * 86400_000).toISOString();
      const window_start = from ?? (oldest && oldest > floorIso ? oldest : floorIso);
      const window_end = to ?? new Date().toISOString();
      let uq = admin
        .from("usage_events")
        .select("cost_cents, metadata")
        .eq("org_id", orgId);
      if (window_start) uq = uq.gte("occurred_at", window_start);
      if (window_end) uq = uq.lte("occurred_at", window_end);
      const { data: usage } = await uq.limit(50000);
      for (const u of (usage ?? []) as Array<{ cost_cents: number | string | null; metadata: { call_id?: string } | null }>) {
        const callId = u.metadata?.call_id;
        if (!callId || !ids.includes(callId)) continue;
        const cents = Number(u.cost_cents ?? 0);
        if (!Number.isFinite(cents)) continue;
        costByCall.set(callId, (costByCall.get(callId) ?? 0) + cents);
      }
    } catch {
      /* costs are best-effort; the table renders with $0.00 fallbacks. */
    }
  }

  // Optional patient context from the CRM (live monitor: BMI / source / call
  // count / name), keyed by phone. Bounded to small result sets (the live
  // active list) so Call Logs stays light. Best-effort.
  type LeadCtx = { name: string | null; bmi: number | null; source: string | null; call_count: number | null; qualification: string | null };
  const leadByPhone = new Map<string, LeadCtx>();
  if (searchParams.get("enrich") === "lead" && calls.length > 0 && calls.length <= 80) {
    try {
      const norm = (p: string | null | undefined) => (p ? String(p).replace(/\s+/g, "") : "");
      const phones = Array.from(new Set((calls as Array<{ to_e164: string | null; from_e164?: string | null }>)
        .flatMap((c) => [c.to_e164, c.from_e164]).filter(Boolean) as string[]));
      if (phones.length > 0) {
        const table = leadsTableFor(leadsSource ?? "prod");
        const { data: leads } = await admin
          .from(table as never)
          .select("nom, numero_telephone, bmi, source_lead, call_count, qualification")
          .in("numero_telephone", phones)
          .limit(500);
        for (const l of (leads ?? []) as Array<{ nom: string | null; numero_telephone: string | null; bmi: number | null; source_lead: string | null; call_count: number | null; qualification: string | null }>) {
          const key = norm(l.numero_telephone);
          if (key) leadByPhone.set(key, { name: l.nom, bmi: l.bmi != null ? Number(l.bmi) : null, source: l.source_lead, call_count: l.call_count, qualification: l.qualification });
        }
      }
    } catch {
      /* enrichment is best-effort */
    }
  }
  const normPhone = (p: string | null | undefined) => (p ? String(p).replace(/\s+/g, "") : "");

  const enriched = calls.map((c) => {
    const cc = c as { to_e164: string | null; from_e164?: string | null };
    const lead = leadByPhone.get(normPhone(cc.to_e164)) ?? leadByPhone.get(normPhone(cc.from_e164)) ?? null;
    return {
      ...c,
      cost_cents: Math.round((costByCall.get(c.id) ?? 0) * 100) / 100,
      lead,
    };
  });
  return NextResponse.json(enriched);
}
