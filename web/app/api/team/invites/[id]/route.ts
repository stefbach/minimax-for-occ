import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg, currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Wave B — manage an existing pending invitation.
//   DELETE  /api/team/invites/[id]            → revoke (set expires_at = now)
//   POST    /api/team/invites/[id] ?action=resend → regenerate token + reset TTL

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin"]);

function originOf(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

function buildAcceptUrl(req: Request, token: string): string {
  return `${originOf(req)}/signup?token=${encodeURIComponent(token)}`;
}

async function gate(): Promise<
  | { ok: true; orgId: string; userId: string }
  | { ok: false; res: NextResponse }
> {
  if (!hasSupabase()) {
    return { ok: false, res: NextResponse.json({ error: "Supabase not configured" }, { status: 500 }) };
  }
  const user = await currentUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const orgId = await currentOrgIdForServer();
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, orgId, userId: user.id };
}

// Ensure the invitation belongs to the caller's org — cross-org access is 404.
async function loadInvite(id: string, orgId: string) {
  const sb = supabaseServer();
  const { data } = await sb
    .from("invitations")
    .select("id, org_id, email, role, token, expires_at, accepted_at, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.org_id !== orgId) return null;
  return data;
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const invite = await loadInvite(id, g.orgId);
  if (!invite) return NextResponse.json({ ok: true }); // idempotent: 200 even if gone

  const sb = supabaseServer();
  const { error } = await sb
    .from("invitations")
    .update({ expires_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "resend";
  if (action !== "resend") {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const invite = await loadInvite(id, g.orgId);
  if (!invite) return NextResponse.json({ error: "invitation introuvable" }, { status: 404 });
  if (invite.accepted_at) {
    return NextResponse.json({ error: "invitation already accepted" }, { status: 410 });
  }

  const newToken = randomUUID();
  const newExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("invitations")
    .update({ token: newToken, expires_at: newExpiry })
    .eq("id", id)
    .select("id, email, role, expires_at, created_at, token")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id as string,
    email: data.email as string,
    role: data.role as string,
    expires_at: data.expires_at as string,
    created_at: data.created_at as string,
    token: data.token as string,
    accept_url: buildAcceptUrl(req, data.token as string),
  });
}
