import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/orgs   { name }
 *
 * Used by the signup flow:
 *   1. Identifies the calling user from the Authorization: Bearer JWT.
 *   2. Creates an organization owned by them and a 'admin' membership.
 *
 * Uses the service role internally to satisfy strict RLS without surfacing
 * the service key to the browser.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 });
  }
  const jwt = auth.slice("Bearer ".length);

  // 1. Identify the user with their own JWT (we only need .auth.getUser).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ error: "Supabase env vars missing" }, { status: 500 });
  }
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }
  const user = userData.user;

  // 2. Create org + membership with service role (bypasses RLS).
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? "").trim() || `Organisation de ${user.email ?? user.id}`;
  const slug = `${name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org"}-${user.id.slice(0, 6)}`;

  const sb = supabaseServer();
  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .insert({ name, slug })
    .select()
    .single();
  if (orgErr) {
    return NextResponse.json({ error: orgErr.message }, { status: 500 });
  }
  const { error: memErr } = await sb
    .from("memberships")
    .insert({ org_id: org.id, user_id: user.id, role: "admin" });
  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, organization: org }, { status: 201 });
}
