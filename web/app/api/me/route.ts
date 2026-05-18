import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me — diagnostic endpoint.
 *
 * Returns the current user's auth identity AND all visible memberships
 * (with org name + role) — same data the middleware uses for route gating.
 * Plus the role the middleware would have picked (oldest membership).
 */
export async function GET() {
  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ authenticated: false });

  const { data: memberships, error } = await sb
    .from("memberships")
    .select("id, role, org_id, created_at, organizations(name, slug)")
    .order("created_at", { ascending: true });

  const primary = memberships?.[0] ?? null;

  return NextResponse.json({
    authenticated: true,
    auth_user: {
      id: user.id,
      email: user.email ?? null,
    },
    memberships: memberships ?? [],
    primary_role: primary?.role ?? null,
    rls_error: error?.message ?? null,
  });
}
