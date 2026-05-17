import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/orgs
 *
 * Super-admin only. Returns every organization with its member count and
 * the number of calls created in the last 7 days. The check is best-effort
 * for now: any membership with role 'super_admin' is allowed, otherwise the
 * caller is rejected unless Supabase is not configured (dev fallback).
 */
export async function GET() {
  if (!hasSupabase()) return NextResponse.json([]);

  // Authorize: only super_admin members may list all orgs.
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseServer();
  const { data: myRoles } = await sb
    .from("memberships")
    .select("role")
    .eq("user_id", user.id);
  const isSuper = (myRoles ?? []).some((r: { role: string }) => r.role === "super_admin");
  if (!isSuper) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: orgs, error } = await sb
    .from("organizations")
    .select("id, name, slug, created_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const rows = await Promise.all(
    (orgs ?? []).map(async (o) => {
      const [mem, calls] = await Promise.all([
        sb.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", o.id),
        sb
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("org_id", o.id)
          .gte("started_at", since),
      ]);
      return {
        ...o,
        members: mem.count ?? 0,
        calls_7d: calls.count ?? 0,
      };
    }),
  );

  return NextResponse.json(rows);
}
