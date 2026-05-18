import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns true if the calling user has at least one `super_admin` membership.
 *  Falls back to false when Supabase is unavailable. */
async function assertSuperAdmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  if (!hasSupabase()) {
    return { ok: false, res: NextResponse.json({ error: "supabase unavailable" }, { status: 503 }) };
  }
  const user = await currentUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const sb = supabaseServer();
  const { data: myRoles } = await sb
    .from("memberships")
    .select("role")
    .eq("user_id", user.id);
  const isSuper = (myRoles ?? []).some((r: { role: string }) => r.role === "super_admin");
  if (!isSuper) {
    return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}

function slugify(input: string, suffix: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";
  return `${base}-${suffix}`;
}

/**
 * GET /api/admin/orgs
 *
 * Super-admin only. Returns every organization with its member count and
 * the number of calls created in the last 7 days.
 */
export async function GET() {
  if (!hasSupabase()) return NextResponse.json([]);
  const gate = await assertSuperAdmin();
  if (!gate.ok) return gate.res;

  const sb = supabaseServer();
  const { data: orgs, error } = await sb
    .from("organizations")
    .select("id, name, slug, created_at, active")
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

/**
 * POST /api/admin/orgs   { name, slug? }
 *
 * Super-admin only. Creates a new organization. The slug is auto-derived
 * from the name (with a random suffix) when not provided.
 */
export async function POST(req: Request) {
  const gate = await assertSuperAdmin();
  if (!gate.ok) return gate.res;

  const body = (await req.json().catch(() => ({}))) as { name?: string; slug?: string };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "missing name" }, { status: 400 });
  }
  const slug = (body.slug ?? "").trim() ||
    slugify(name, Math.random().toString(36).slice(2, 8));

  const sb = supabaseServer();
  const { data: org, error } = await sb
    .from("organizations")
    .insert({ name, slug })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, organization: org }, { status: 201 });
}

/**
 * PATCH /api/admin/orgs   { id, active }
 *
 * Super-admin only. Flips the `active` flag on an organization. Used to
 * block / unblock a tenant without deleting their data.
 */
export async function PATCH(req: Request) {
  const gate = await assertSuperAdmin();
  if (!gate.ok) return gate.res;

  const body = (await req.json().catch(() => ({}))) as { id?: string; active?: boolean };
  const id = (body.id ?? "").trim();
  if (!id || typeof body.active !== "boolean") {
    return NextResponse.json({ error: "missing id or active" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("organizations")
    .update({ active: body.active })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, organization: data });
}
