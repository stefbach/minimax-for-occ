import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/inbound-secrets?org_id=
 * List inbound webhook secrets for the org. The secret itself is returned so
 * that the admin UI can offer a "Copier l'URL webhook" button — this route is
 * only reachable by admins (no extra auth check yet, but it sits behind the
 * platform's middleware role guard like the rest of /api/admin/*).
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const sb = supabaseServer();
  const org_id = await requestOrgId(req);

  const { data, error } = await sb
    .from("inbound_webhook_secrets")
    .select("id, org_id, name, secret, campaign_id, enabled, created_at")
    .eq("org_id", org_id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/**
 * POST /api/admin/inbound-secrets
 * Body: { org_id?, name, campaign_id? }
 * Generates a 32-byte url-safe random secret and stores it. Returns the row.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }
  const body = (await req.json().catch(() => null)) as {
    org_id?: string;
    name?: string;
    campaign_id?: string | null;
  } | null;
  const name = (body?.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name requis" }, { status: 400 });
  // org_id always derived from session; body.org_id is silently ignored.
  const org_id = await requestOrgId(req);
  const campaign_id = body?.campaign_id ?? null;

  // url-safe base64 (no padding) of 32 random bytes ≈ 43 chars.
  const secret = randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("inbound_webhook_secrets")
    .insert({ org_id, name, secret, campaign_id, enabled: true })
    .select("id, org_id, name, secret, campaign_id, enabled, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

/**
 * DELETE /api/admin/inbound-secrets?id=...
 */
export async function DELETE(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("inbound_webhook_secrets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
