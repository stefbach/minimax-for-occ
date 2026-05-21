import { NextResponse } from "next/server";
import {
  currentOrgFromCookie,
  currentRoleInOrg,
  currentUserOrgs,
  supabaseSession,
} from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me
 *
 * Returns the current user, the orgs they belong to, the org they have
 * actively selected via the `axon.org_id` cookie (falling back to their
 * oldest membership) and the resolved role inside that org.
 *
 * Consumed by the client-side OrgSwitcher and any UI that needs to know
 * "which org am I currently acting on, and as what role".
 */
export async function GET() {
  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const orgs = await currentUserOrgs();
  // Dedupe by org id: a super_admin reading the memberships table sees every
  // row (RLS on memberships is permissive today, see Sprint 1 follow-up), so
  // if two users share the same org it would surface that org twice in the
  // switcher. Keep the first occurrence — that's the current user's own
  // membership when ordered by created_at ascending.
  const seenOrgs = new Set<string>();
  const flatOrgs = orgs
    .map((m) => (m.organizations ? { ...m.organizations, role: m.role } : null))
    .filter((o): o is { id: string; name: string; slug: string; role: string } => {
      if (!o) return false;
      if (seenOrgs.has(o.id)) return false;
      seenOrgs.add(o.id);
      return true;
    });

  let currentOrgId = await currentOrgFromCookie();
  // Fallback: cookie absent or stale — use oldest membership.
  if (!currentOrgId || !flatOrgs.some((o) => o.id === currentOrgId)) {
    currentOrgId = flatOrgs[0]?.id ?? null;
  }

  const currentRole = currentOrgId ? await currentRoleInOrg(currentOrgId) : null;

  return NextResponse.json({
    user: { id: user.id, email: user.email ?? null },
    orgs: flatOrgs,
    current_org_id: currentOrgId,
    current_role: currentRole,
  });
}
