import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERVISOR_ROLES = new Set([
  "super_admin",
  "owner",
  "admin",
  "manager",
  "supervisor",
]);

/**
 * GET /api/desk/agents
 *
 * Returns the org's human agents (memberships.role = 'agent') joined with
 * profiles.is_active so the supervisor reassign dropdown can label users
 * + skip inactive ones. Restricted to supervisor+ roles since the user
 * list itself is sensitive.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ agents: [] });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !SUPERVISOR_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = supabaseServer();
  const { data: mems, error } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", orgId)
    .eq("role", "agent");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (mems ?? []).map((m) => (m as { user_id: string }).user_id);
  if (ids.length === 0) return NextResponse.json({ agents: [] });

  const { data: profs } = await admin
    .from("profiles")
    .select("id, full_name, email, is_active")
    .in("id", ids);

  const profMap = new Map<string, { full_name: string | null; email: string | null; is_active: boolean | null }>();
  for (const p of profs ?? []) {
    const r = p as { id: string; full_name: string | null; email: string | null; is_active: boolean | null };
    profMap.set(r.id, r);
  }

  const agents = ids.map((id) => {
    const p = profMap.get(id);
    return {
      user_id: id,
      display_name: p?.full_name ?? p?.email ?? id.slice(0, 8),
      email: p?.email ?? null,
      is_active: p?.is_active !== false,
    };
  });
  return NextResponse.json({ agents });
}
