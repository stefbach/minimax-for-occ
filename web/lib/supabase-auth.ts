import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyOrgCookie } from "@/lib/org-cookie";

/** Name of the HttpOnly cookie used to remember the currently-selected org
 *  across requests. Set by POST /api/orgs/switch (and the super_admin
 *  impersonate endpoint), read by the middleware + server components. */
export const ORG_COOKIE = "axon.org_id";

/**
 * Server-side Supabase client bound to the user's auth cookies.
 * Read-only against cookies in Server Components; writes only work
 * from Route Handlers and middleware.
 */
export async function supabaseSession(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Supabase URL or anon key missing for server session.");
  }
  const store = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return store.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(toSet) {
        try {
          for (const c of toSet) store.set(c.name, c.value, c.options);
        } catch {
          // Server Components can't write cookies — silently ignore.
        }
      },
    },
  });
}

/** Convenience: returns the logged-in user (or null). */
export async function currentUser() {
  const sb = await supabaseSession();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

/** Convenience: list the orgs the current user belongs to. */
export async function currentUserOrgs() {
  const sb = await supabaseSession();
  const { data } = await sb
    .from("memberships")
    .select("role, organizations(id, name, slug)")
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as Array<{
    role: string;
    organizations: { id: string; name: string; slug: string } | null;
  }>;
}

export type AppRole = "super_admin" | "admin" | "manager" | "supervisor" | "agent";

/** Returns the user's primary membership (first one by created_at), or null. */
export async function currentMembership(): Promise<{
  org_id: string;
  role: AppRole;
} | null> {
  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from("memberships")
    .select("org_id, role")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { org_id: data.org_id as string, role: (data.role as AppRole) ?? "agent" };
}

/**
 * Reads the currently-selected org id from the HttpOnly cookie set by
 * /api/orgs/switch. Returns null when the cookie is absent — callers should
 * then fall back to the user's primary membership.
 */
export async function currentOrgFromCookie(): Promise<string | null> {
  const store = await cookies();
  const c = store.get(ORG_COOKIE);
  // Verify the signature + freshness of the cookie. verifyOrgCookie also
  // accepts the legacy unsigned UUID form for backwards compatibility.
  return verifyOrgCookie(c?.value);
}

/**
 * Resolve the current user's role for a given org. Returns null when the
 * user has no membership in that org. The middleware uses this to enforce
 * role-based access for the org the user has actively switched to.
 */
export async function currentRoleInOrg(orgId: string): Promise<AppRole | null> {
  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return (data.role as AppRole) ?? null;
}

/** Where a given role should land after login or when hitting `/`. */
export function landingPathFor(role: AppRole | string | undefined): string {
  switch (role) {
    case "super_admin":
    case "admin":
      return "/admin";
    case "manager":
      return "/dashboard";
    case "supervisor":
      return "/dashboard"; // /supervision will replace this when shipped
    case "agent":
      return "/desk";
    default:
      return "/dashboard";
  }
}
