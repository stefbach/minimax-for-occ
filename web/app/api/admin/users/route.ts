import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

function orgFrom(req: Request): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("org_id") ?? DEFAULT_ORG;
}

/**
 * GET /api/admin/users?org_id=
 *
 * List memberships of the given organization, enriched with the auth user's
 * email + last_sign_in_at via the Supabase Admin API.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const sb = supabaseServer();
  const orgId = orgFrom(req);

  const { data: members, error } = await sb
    .from("memberships")
    .select("id, org_id, user_id, role, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hydrate with auth users. Admin API does not support filtering by ids,
  // so we list pages and index by id. For now the user base is small.
  const idsNeeded = new Set((members ?? []).map((m) => m.user_id));
  const byId = new Map<string, { email: string | null; last_sign_in_at: string | null; display_name: string | null }>();
  let page = 1;
  const perPage = 200;
  // Cap loop to a few pages to keep the route fast.
  for (let i = 0; i < 10; i++) {
    const { data: pageData, error: aErr } = await sb.auth.admin.listUsers({ page, perPage });
    if (aErr) break;
    const users = pageData?.users ?? [];
    for (const u of users) {
      if (idsNeeded.has(u.id)) {
        byId.set(u.id, {
          email: u.email ?? null,
          last_sign_in_at: (u.last_sign_in_at as string | undefined) ?? null,
          display_name:
            (u.user_metadata?.display_name as string | undefined) ??
            (u.user_metadata?.full_name as string | undefined) ??
            null,
        });
      }
    }
    if (users.length < perPage) break;
    page += 1;
  }

  const rows = (members ?? []).map((m) => {
    const u = byId.get(m.user_id);
    return {
      id: m.id,
      org_id: m.org_id,
      user_id: m.user_id,
      role: m.role,
      created_at: m.created_at,
      email: u?.email ?? null,
      display_name: u?.display_name ?? null,
      last_seen: u?.last_sign_in_at ?? null,
    };
  });

  return NextResponse.json(rows);
}

/**
 * POST /api/admin/users   { email, password, role, display_name?, org_id? }
 *
 * Creates an auth user with a confirmed email + password, then attaches a
 * membership row to the target organization. Reuses the auth user if one
 * already exists with the same email — in that case only the membership is
 * added (or its role updated if it already exists).
 */
export async function POST(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    role?: string;
    display_name?: string;
    org_id?: string;
  };
  if (!body.email || !body.password || !body.role) {
    return NextResponse.json({ error: "email, password and role required" }, { status: 400 });
  }
  if (body.password.length < 8) {
    return NextResponse.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }
  const orgId = body.org_id ?? DEFAULT_ORG;
  const sb = supabaseServer();

  // 1) Try to create the auth user
  let userId: string | null = null;
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: body.display_name ? { display_name: body.display_name } : undefined,
  });
  if (created?.user?.id) {
    userId = created.user.id;
  } else if (createErr && /already/i.test(createErr.message)) {
    // 2) User already exists — find them by listing pages
    let page = 1;
    const perPage = 200;
    for (let i = 0; i < 10 && !userId; i++) {
      const { data: pageData } = await sb.auth.admin.listUsers({ page, perPage });
      const users = pageData?.users ?? [];
      const match = users.find((u) => u.email?.toLowerCase() === body.email!.toLowerCase());
      if (match) { userId = match.id; break; }
      if (users.length < perPage) break;
      page += 1;
    }
    if (!userId) {
      return NextResponse.json({ error: "user exists but could not be located" }, { status: 500 });
    }
  } else if (createErr) {
    return NextResponse.json({ error: createErr.message }, { status: 500 });
  }

  if (!userId) return NextResponse.json({ error: "user creation failed" }, { status: 500 });

  // 3) Upsert membership for the org
  const { data: existing } = await sb
    .from("memberships")
    .select("id, role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    if (existing.role !== body.role) {
      const { error: upErr } = await sb
        .from("memberships")
        .update({ role: body.role })
        .eq("id", existing.id);
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  } else {
    const { error: insErr } = await sb
      .from("memberships")
      .insert({ org_id: orgId, user_id: userId, role: body.role });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, user_id: userId, email: body.email }, { status: 201 });
}

/**
 * PATCH /api/admin/users   { user_id, role, org_id? }
 *
 * Update the role of an existing membership row.
 */
export async function PATCH(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const body = (await req.json().catch(() => ({}))) as {
    user_id?: string;
    role?: string;
    org_id?: string;
  };
  if (!body.user_id || !body.role) {
    return NextResponse.json({ error: "user_id and role required" }, { status: 400 });
  }
  const orgId = body.org_id ?? DEFAULT_ORG;
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("memberships")
    .update({ role: body.role })
    .eq("org_id", orgId)
    .eq("user_id", body.user_id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * DELETE /api/admin/users?user_id=&org_id=
 *
 * Removes a membership from the organization. Does NOT delete the auth user.
 */
export async function DELETE(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("user_id");
  const orgId = searchParams.get("org_id") ?? DEFAULT_ORG;
  if (!userId) return NextResponse.json({ error: "user_id required" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb
    .from("memberships")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
