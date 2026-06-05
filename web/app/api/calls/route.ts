import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { callBelongsToLeadsSource, phoneSetForLeadsSource, type LeadsSource } from "@/lib/leads-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      .in("state", ["queued", "ringing", "ivr", "in_progress"])
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
  const phoneSet = leadsSource ? await phoneSetForLeadsSource(leadsSource) : null;

  const calls = ((data ?? []) as Array<{ id: string; started_at: string | null; to_e164: string | null }>)
    .filter((c) => callBelongsToLeadsSource(c.to_e164 ?? null, phoneSet));

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
      const window_start = from ?? oldest ?? undefined;
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

  const enriched = calls.map((c) => ({
    ...c,
    cost_cents: Math.round((costByCall.get(c.id) ?? 0) * 100) / 100,
  }));
  return NextResponse.json(enriched);
}
