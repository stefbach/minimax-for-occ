import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/accept-invite   { token, user_id }
 *
 * Server-side, using the service role:
 *   1. Looks up the invitation by token (must be unaccepted + not expired).
 *   2. Creates the corresponding memberships row.
 *   3. Marks the invitation as accepted.
 *
 * Used by /signup when a ?token= query param is present in the URL.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    user_id?: string;
  };
  if (!body.token || !body.user_id) {
    return NextResponse.json({ error: "token and user_id required" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data: invite, error: invErr } = await sb
    .from("invitations")
    .select("id, org_id, role, accepted_at, expires_at")
    .eq("token", body.token)
    .maybeSingle();
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });
  if (!invite) return NextResponse.json({ error: "invitation not found" }, { status: 404 });
  if (invite.accepted_at) {
    return NextResponse.json({ error: "invitation already accepted" }, { status: 410 });
  }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "invitation expired" }, { status: 410 });
  }

  // Create the membership. Use upsert in case the user is somehow already a member.
  const { error: memErr } = await sb
    .from("memberships")
    .upsert(
      { org_id: invite.org_id, user_id: body.user_id, role: invite.role },
      { onConflict: "org_id,user_id" },
    );
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });

  const { error: updErr } = await sb
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    org_id: invite.org_id,
    role: invite.role,
  });
}
