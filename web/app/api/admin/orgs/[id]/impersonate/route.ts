import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { ORG_COOKIE, currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orgs/:id/impersonate
 *
 * Super-admin-only escape hatch: sets the `axon.org_id` cookie to the
 * requested org so the middleware applies that org's context for the
 * super_admin user — without requiring them to actually be a member.
 *
 * Note on roles: the user keeps their own role(s). When they don't have
 * an explicit membership in the impersonated org, `currentRoleInOrg` will
 * return null and the middleware will redirect to /desk. Super admins who
 * need a higher role for support work should grant themselves a
 * temporary membership via /api/admin/users instead.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase unavailable" }, { status: 503 });
  }

  const { id } = await ctx.params;
  const orgId = (id ?? "").trim();
  if (!orgId) {
    return NextResponse.json({ error: "missing org id" }, { status: 400 });
  }

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseServer();
  const { data: myRoles } = await sb
    .from("memberships")
    .select("role")
    .eq("user_id", user.id);
  const isSuper = (myRoles ?? []).some((r: { role: string }) => r.role === "super_admin");
  if (!isSuper) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Verify the target org actually exists.
  const { data: org } = await sb
    .from("organizations")
    .select("id, name, slug")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) {
    return NextResponse.json({ error: "org not found" }, { status: 404 });
  }

  const store = await cookies();
  store.set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({ ok: true, organization: org });
}
