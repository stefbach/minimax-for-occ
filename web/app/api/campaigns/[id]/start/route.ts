import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Idempotent campaign start.
 *  - Flips state to 'running' (if not already in a terminal state).
 *  - Schedules the first batch by marking up to `max_concurrency` pending targets
 *    with next_attempt_at = now(). The dialer worker picks these up.
 *  - Writes an event_log row.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const { id } = await ctx.params;
  const sb = supabaseServer();

  const { data: campaign, error: cErr } = await sb
    .from("campaigns")
    .select("id,org_id,state,max_concurrency")
    .eq("id", id)
    .single();
  if (cErr || !campaign) {
    return NextResponse.json({ error: cErr?.message ?? "campagne introuvable" }, { status: 404 });
  }
  if (campaign.state === "completed" || campaign.state === "cancelled") {
    return NextResponse.json(
      { error: `campagne en état ${campaign.state}, impossible de démarrer` },
      { status: 409 },
    );
  }

  // Move to running (idempotent — no-op if already running).
  if (campaign.state !== "running") {
    const { error: upErr } = await sb
      .from("campaigns")
      .update({ state: "running", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Pick up to max_concurrency targets that have no scheduled attempt yet.
  const max = campaign.max_concurrency ?? 5;
  const { data: pending } = await sb
    .from("campaign_targets")
    .select("id")
    .eq("campaign_id", id)
    .eq("status", "pending")
    .is("next_attempt_at", null)
    .limit(max);

  const nowIso = new Date().toISOString();
  let scheduled = 0;
  if (pending && pending.length > 0) {
    const ids = pending.map((p) => p.id);
    const { error: schedErr } = await sb
      .from("campaign_targets")
      .update({ next_attempt_at: nowIso })
      .in("id", ids);
    if (schedErr) return NextResponse.json({ error: schedErr.message }, { status: 500 });
    scheduled = ids.length;
  }

  await sb.from("event_log").insert({
    org_id: campaign.org_id,
    actor_kind: "system",
    entity: "campaign",
    entity_id: id,
    action: "started",
    payload: { scheduled },
  });

  return NextResponse.json({ ok: true, state: "running", scheduled });
}
