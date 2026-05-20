/**
 * Centralised request-context resolution for API route handlers.
 *
 * Goals of this module:
 *   1. Always derive `orgId` from the authenticated user's session (cookie
 *      first, oldest membership as fallback) — NEVER from a query param
 *      unless the caller explicitly opted in and is super_admin.
 *   2. Return a single `RequestContext` shape that downstream code can rely
 *      on (userId, orgId, role, isSuper), so routes don't have to wire up
 *      the same auth/membership/role queries themselves.
 *   3. Throw structured errors (HttpError) that callers can convert into a
 *      NextResponse without re-implementing the 401/403 plumbing.
 *
 * Why a new module instead of editing `request-org.ts`?
 *   Older routes call `requestOrgId(req)` and silently fall back to the
 *   Legacy org for unauthenticated callers (webhooks, server jobs). Changing
 *   that contract would be a breaking change for those callers, so we keep
 *   the legacy helper and introduce this stricter one for routes that
 *   actually require an authenticated user.
 */

import { cookies } from "next/headers";
import { ORG_COOKIE, supabaseSession, type AppRole } from "./supabase-auth";

export type RequestContext = {
  userId: string;
  orgId: string;
  role: AppRole;
  isSuper: boolean;
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

export type RequireContextOptions = {
  /**
   * Honour `?org_id=` on the request URL only when the authenticated user is
   * super_admin (impersonation flow). When false (the default), the query
   * param is ignored entirely and a warning is logged if it was supplied by
   * a non-super user — this protects every route from accidental
   * cross-tenant reads when RLS isn't perfectly tight.
   */
  allowOrgQueryParam?: boolean;
};

/**
 * Resolve the request context for an authenticated API route.
 *
 * Throws HttpError(401) if no user, HttpError(403) if the user has no
 * membership in the resolved org.
 */
export async function requireContext(
  req: Request,
  opts: RequireContextOptions = {},
): Promise<RequestContext> {
  const sb = await supabaseSession();
  const { data: userData } = await sb.auth.getUser();
  const user = userData?.user ?? null;
  if (!user) {
    throw new HttpError(401, "authentication required");
  }

  // Load all memberships once — needed to decide super_admin status and to
  // validate the current-org cookie.
  const { data: memberships } = await sb
    .from("memberships")
    .select("org_id, role, created_at")
    .order("created_at", { ascending: true });
  const rows = (memberships ?? []) as Array<{
    org_id: string;
    role: AppRole;
    created_at: string;
  }>;
  const isSuper = rows.some((m) => m.role === "super_admin");

  // 1. Cookie (set by /api/orgs/switch) wins if it points at a real membership.
  const store = await cookies();
  const cookieOrg = store.get(ORG_COOKIE)?.value || null;

  // 2. Otherwise fall back to the user's primary (oldest) membership.
  const primary = rows[0]?.org_id ?? null;

  let orgId: string | null = null;
  if (cookieOrg && (isSuper || rows.some((m) => m.org_id === cookieOrg))) {
    orgId = cookieOrg;
  } else {
    orgId = primary;
  }

  // 3. ?org_id= override — only honoured if explicitly allowed AND user is
  //    super_admin. Non-super callers get a warning so we can spot stale
  //    client code that's still passing the param.
  const url = new URL(req.url);
  const wanted = url.searchParams.get("org_id");
  if (wanted) {
    if (opts.allowOrgQueryParam && isSuper) {
      orgId = wanted;
    } else if (!isSuper) {
      // Don't crash on existing UIs — just log and ignore.
      console.warn(
        "[requireContext] ?org_id= ignored for non-super user",
        { userId: user.id, requestedOrg: wanted, route: url.pathname },
      );
    }
  }

  if (!orgId) {
    // Authenticated but no membership at all — explicit 403 beats RLS
    // silently returning empty arrays.
    throw new HttpError(403, "no organization membership");
  }

  const role = rows.find((m) => m.org_id === orgId)?.role
    ?? (isSuper ? ("super_admin" as AppRole) : null);
  if (!role) {
    throw new HttpError(403, "no role in organization");
  }

  return { userId: user.id, orgId, role, isSuper };
}

/**
 * Type guard for the structured errors thrown by `requireContext`.
 */
export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError;
}
