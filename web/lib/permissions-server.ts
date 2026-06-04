import { supabaseSession } from "@/lib/supabase-auth";
import { hasModule, isModuleId, type ModuleId } from "@/lib/permissions";

/**
 * Server-side guard helper for API route handlers.
 *
 * Resolves the current user's role and membership-level `visible_modules`
 * for the given org, and checks whether `module` is visible. The caller is
 * expected to short-circuit with a 403 when `allowed === false`:
 *
 *   const g = await requireModule(orgId, "dashboard");
 *   if (!g.allowed) {
 *     return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
 *   }
 *
 * Failure reasons (`reason`) are deliberately coarse strings, useful for
 * server logs / tests but never surfaced verbatim to the client.
 */
export async function requireModule(
  orgId: string,
  module: ModuleId,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!isModuleId(module)) {
    return { allowed: false, reason: "unknown_module" };
  }
  const sb = await supabaseSession();
  const { data: userData } = await sb.auth.getUser();
  const user = userData?.user ?? null;
  if (!user) return { allowed: false, reason: "unauthorized" };

  const { data, error } = await sb
    .from("memberships")
    .select("role, visible_modules")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return { allowed: false, reason: "lookup_failed" };
  if (!data) return { allowed: false, reason: "no_membership" };

  const row = data as { role: string | null; visible_modules: unknown };
  const vm = Array.isArray(row.visible_modules)
    ? (row.visible_modules as unknown[]).filter(isModuleId)
    : null;
  const ok = hasModule({ role: row.role, visible_modules: vm }, module);
  return ok ? { allowed: true } : { allowed: false, reason: "module_forbidden" };
}
