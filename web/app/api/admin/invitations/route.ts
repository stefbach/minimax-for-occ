import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

function orgFrom(req: Request): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("org_id") ?? DEFAULT_ORG;
}

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

function buildAcceptUrl(req: Request, token: string): string {
  const origin = new URL(req.url).origin;
  return `${origin}/signup?token=${encodeURIComponent(token)}`;
}

/**
 * GET /api/admin/invitations?org_id=
 *
 * List pending invitations (not yet accepted) for the org.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("invitations")
    .select("*")
    .eq("org_id", orgFrom(req))
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []).map((r) => ({
    ...r,
    accept_url: `${new URL(req.url).origin}/signup?token=${encodeURIComponent(r.token)}`,
  }));
  return NextResponse.json(rows);
}

/**
 * POST /api/admin/invitations   { email, role, org_id? }
 *
 * Create a new invitation row with a random token. Returns the row enriched
 * with an accept_url ready to be copied to the clipboard.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    role?: string;
    org_id?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  const role = body.role ?? "agent";
  const orgId = body.org_id ?? DEFAULT_ORG;
  const token = generateToken();

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("invitations")
    .insert({ org_id: orgId, email, role, token })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { ...data, accept_url: buildAcceptUrl(req, data.token) },
    { status: 201 },
  );
}

/**
 * DELETE /api/admin/invitations?id=
 *
 * Revokes (hard-deletes) a pending invitation.
 */
export async function DELETE(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("invitations").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
