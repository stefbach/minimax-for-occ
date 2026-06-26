import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/campaigns/:id/toggle   body: { activate: boolean }
 *
 * Lets a human agent start/pause one of THEIR OWN desk campaigns from
 * "Mon poste". Activating flips the campaign to `running` so the dialer
 * begins the next due slot (pre-call SMS/WhatsApp + dial to the agent's
 * softphone); deactivating flips it to `paused` so nothing more is sent.
 *
 * Authorization: the campaign's agent_handle must be a `kind='human'` handle
 * owned by the calling user, in the active org. Anything else → 403/404.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { activate?: boolean } | null;
  if (typeof body?.activate !== "boolean") {
    return NextResponse.json({ error: "champ 'activate' (booléen) requis" }, { status: 400 });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  // Load the campaign + its handle, scoped to the org.
  const { data: campaign, error } = await admin
    .from("campaigns")
    .select("id, state, agent_handle_id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!campaign) return NextResponse.json({ error: "introuvable" }, { status: 404 });

  // The handle must be a human handle owned by this user.
  const { data: handle } = await admin
    .from("agent_handles")
    .select("id, kind, user_id")
    .eq("id", campaign.agent_handle_id as string)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!handle || handle.kind !== "human" || handle.user_id !== user.id) {
    return NextResponse.json({ error: "Cette campagne ne vous est pas assignée." }, { status: 403 });
  }

  const current = campaign.state as string;
  if (current === "completed" || current === "cancelled") {
    return NextResponse.json({ error: `Campagne ${current} — non modifiable.` }, { status: 409 });
  }

  const nextState = body.activate ? "running" : "paused";
  const { error: upErr } = await admin
    .from("campaigns")
    .update({ state: nextState, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  await admin.from("event_log").insert({
    org_id: orgId,
    actor_kind: "user",
    actor_user_id: user.id,
    entity: "campaign",
    entity_id: id,
    action: body.activate ? "desk_activated" : "desk_paused",
    payload: { from: current, to: nextState },
  });

  return NextResponse.json({ ok: true, state: nextState });
}
