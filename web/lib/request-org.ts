import { supabaseSession } from "./supabase-auth";
import { supabaseServer } from "./supabase";

const LEGACY_ORG = "00000000-0000-0000-0000-000000000001";

/**
 * Resolve the org_id a request should operate on.
 *
 * Priority order:
 *   1. Caller-provided `?org_id=` on the request URL — only honored if the
 *      authenticated user has a membership in that org (or is super_admin).
 *   2. The user's primary membership (first by created_at).
 *   3. Fallback to the historical Legacy org (kept for backward compat with
 *      v1 routes that haven't been migrated yet).
 *
 * Designed for Route Handlers — pass the `Request` to inspect the URL.
 */
export async function requestOrgId(req: Request): Promise<string> {
  const sb = await supabaseSession();
  const { data: userData } = await sb.auth.getUser();
  const user = userData?.user ?? null;

  const url = new URL(req.url);
  const wanted = url.searchParams.get("org_id");

  if (!user) {
    // Unauthenticated → legacy fallback (server-side jobs / first deploy).
    return wanted ?? LEGACY_ORG;
  }

  // Look up the user's memberships. We use the user-scoped client so RLS is
  // enforced (a user can only see their own memberships).
  const { data: memberships } = await sb
    .from("memberships")
    .select("org_id, role")
    .order("created_at", { ascending: true });

  const rows = (memberships ?? []) as Array<{ org_id: string; role: string }>;
  const isSuper = rows.some((m) => m.role === "super_admin");

  if (wanted) {
    if (isSuper) return wanted;
    if (rows.some((m) => m.org_id === wanted)) return wanted;
    // Asked for an org the user doesn't belong to — fall through to their primary.
  }

  return rows[0]?.org_id ?? LEGACY_ORG;
}

/**
 * Same as requestOrgId but also returns whether the user is super_admin and
 * the resolved role for the chosen org (for finer-grained gating).
 */
export async function requestContext(req: Request): Promise<{
  org_id: string;
  user_id: string | null;
  role: string | null;
  is_super_admin: boolean;
}> {
  const sb = await supabaseSession();
  const { data: userData } = await sb.auth.getUser();
  const user = userData?.user ?? null;

  const url = new URL(req.url);
  const wanted = url.searchParams.get("org_id");

  if (!user) {
    return { org_id: wanted ?? LEGACY_ORG, user_id: null, role: null, is_super_admin: false };
  }

  const { data: memberships } = await sb
    .from("memberships")
    .select("org_id, role")
    .order("created_at", { ascending: true });
  const rows = (memberships ?? []) as Array<{ org_id: string; role: string }>;
  const isSuper = rows.some((m) => m.role === "super_admin");

  let orgId: string;
  if (wanted && (isSuper || rows.some((m) => m.org_id === wanted))) {
    orgId = wanted;
  } else {
    orgId = rows[0]?.org_id ?? LEGACY_ORG;
  }

  const role = rows.find((m) => m.org_id === orgId)?.role ?? null;
  return { org_id: orgId, user_id: user.id, role, is_super_admin: isSuper };
}

/**
 * Used by server components / API routes that need a service-role DB
 * client AND the org context derived from the user's session.
 */
export async function authedDb(req: Request) {
  const ctx = await requestContext(req);
  return { sb: supabaseServer(), ...ctx };
}
