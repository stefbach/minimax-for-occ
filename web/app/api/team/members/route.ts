import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg, currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Team management API — list the org's members for the /team page.
// Visible only to owner/admin (gate enforced here AND in the page).
//
// memberships has no FK→profiles, so we fetch the two tables separately and
// merge in Node. 'status' is derived from profiles.is_active until Wave B
// introduces the org_invites table (which will surface "invited" state).

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin"]);

export type TeamMember = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  status: "active" | "disabled";
  created_at: string | null;
  is_self: boolean;
};
export type TeamMembersResponse = { members: TeamMember[]; current_user_id: string | null };

export async function GET() {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const orgId = await currentOrgIdForServer();
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const me = await currentUser();
  const meId = me?.id ?? null;
  const sb = supabaseServer();

  const { data: msRows, error: msErr } = await sb
    .from("memberships")
    .select("user_id, role, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (msErr) return NextResponse.json({ error: msErr.message }, { status: 500 });
  const memberships = (msRows ?? []) as Array<{ user_id: string; role: string; created_at: string | null }>;

  const userIds = memberships.map((m) => m.user_id).filter(Boolean);
  let profileById = new Map<string, { email: string | null; full_name: string | null; is_active: boolean | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await sb
      .from("profiles")
      .select("id, email, full_name, is_active")
      .in("id", userIds);
    for (const p of (profs ?? []) as Array<{
      id: string; email: string | null; full_name: string | null; is_active: boolean | null;
    }>) {
      profileById.set(p.id, { email: p.email, full_name: p.full_name, is_active: p.is_active });
    }
  }

  const members: TeamMember[] = memberships.map((m) => {
    const p = profileById.get(m.user_id);
    return {
      user_id: m.user_id,
      email: p?.email ?? null,
      display_name: p?.full_name ?? null,
      role: m.role || "agent",
      status: p?.is_active === false ? "disabled" : "active",
      created_at: m.created_at,
      is_self: meId !== null && m.user_id === meId,
    };
  });

  return NextResponse.json({ members, current_user_id: meId });
}
