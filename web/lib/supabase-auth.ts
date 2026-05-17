import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

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
