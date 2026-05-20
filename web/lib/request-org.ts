import { cookies } from "next/headers";
import { ORG_COOKIE, supabaseSession } from "./supabase-auth";
import { supabaseServer } from "./supabase";
import { LEGACY_ORG_ID } from "./constants";

/**
 * Resolve the org_id a request should operate on.
 *
 * Priority order:
 *   1. The current-org cookie (set by /api/orgs/switch), iff the user has a
 *      membership in that org or is super_admin.
 *   2. Caller-provided `?org_id=` on the request URL — only honored when the
 *      authenticated user is super_admin. For everyone else the query param
 *      is now IGNORED and a warning is logged (cross-tenant read protection,
 *      sprint 6).
 *   3. The user's primary membership (first by created_at).
 *   4. Fallback to the historical Legacy org (kept for backward compat with
 *      unauthenticated callers — webhooks, server jobs, first deploy).
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
    return wanted ?? LEGACY_ORG_ID;
  }

  // Look up the user's memberships. We use the user-scoped client so RLS is
  // enforced (a user can only see their own memberships).
  const { data: memberships } = await sb
    .from("memberships")
    .select("org_id, role")
    .order("created_at", { ascending: true });

  const rows = (memberships ?? []) as Array<{ org_id: string; role: string }>;
  const isSuper = rows.some((m) => m.role === "super_admin");

  // Cookie wins for the regular tenant-switching flow.
  const store = await cookies();
  const cookieOrg = store.get(ORG_COOKIE)?.value || null;
  if (cookieOrg && (isSuper || rows.some((m) => m.org_id === cookieOrg))) {
    if (wanted && wanted !== cookieOrg && !isSuper) {
      console.warn(
        "[requestOrgId] ?org_id= ignored for non-super user",
        { userId: user.id, requestedOrg: wanted, cookieOrg },
      );
    }
    return cookieOrg;
  }

  // Query param impersonation: only super_admin may force a different org.
  if (wanted) {
    if (isSuper) return wanted;
    console.warn(
      "[requestOrgId] ?org_id= ignored for non-super user (no cookie)",
      { userId: user.id, requestedOrg: wanted },
    );
  }

  return rows[0]?.org_id ?? LEGACY_ORG_ID;
}

/**
 * Same as requestOrgId but also returns whether the user is super_admin and
 * the resolved role for the chosen org (for finer-grained gating).
 *
 * Note: this is the *legacy* RequestContext shape (snake_case, lenient — does
 * not throw on missing user). For new code prefer `requireContext` from
 * `./request-context` which throws 401/403 cleanly.
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
    return {
      org_id: wanted ?? LEGACY_ORG_ID,
      user_id: null,
      role: null,
      is_super_admin: false,
    };
  }

  const { data: memberships } = await sb
    .from("memberships")
    .select("org_id, role")
    .order("created_at", { ascending: true });
  const rows = (memberships ?? []) as Array<{ org_id: string; role: string }>;
  const isSuper = rows.some((m) => m.role === "super_admin");

  const store = await cookies();
  const cookieOrg = store.get(ORG_COOKIE)?.value || null;

  let orgId: string;
  if (cookieOrg && (isSuper || rows.some((m) => m.org_id === cookieOrg))) {
    orgId = cookieOrg;
  } else if (wanted && isSuper) {
    orgId = wanted;
  } else {
    if (wanted && !isSuper) {
      console.warn(
        "[requestContext] ?org_id= ignored for non-super user",
        { userId: user.id, requestedOrg: wanted },
      );
    }
    orgId = rows[0]?.org_id ?? LEGACY_ORG_ID;
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
