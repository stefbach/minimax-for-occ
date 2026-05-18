import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ORG_COOKIE, supabaseSession } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/orgs/switch  { org_id }
 *
 * Persists the active org for the current user inside the HttpOnly cookie
 * `axon.org_id`. The middleware reads this cookie on every request to look
 * up the user's role in that org and apply path-based access control.
 *
 * Authorization: caller must have an active session AND be a member of the
 * target org (the super_admin impersonation flow lives in a separate route).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { org_id?: string };
  const orgId = (body.org_id ?? "").trim();
  if (!orgId) {
    return NextResponse.json({ error: "missing org_id" }, { status: 400 });
  }

  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Verify membership using the user-scoped client — RLS guarantees the user
  // can only see their own rows, so this is also an implicit auth check.
  const { data: membership } = await sb
    .from("memberships")
    .select("org_id, role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "not a member of this org" }, { status: 403 });
  }

  const store = await cookies();
  store.set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    // 30 days — long-lived; the user can switch back at any time.
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({ ok: true, org_id: orgId, role: membership.role });
}
