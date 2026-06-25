import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-id endpoints. The collection route (`/api/numbers`) still accepts
 * `?id=` for backwards compatibility with the existing UI, but new code
 * should target this path.
 */

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("phone_numbers")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "body requis" }, { status: 400 });

  const allowed = [
    "label",
    "active",
    "inbound_enabled",
    "human_first_enabled",
    "flow_id",
    "queue_id",
    "agent_handle_id",
    "compliance_jurisdiction",
    "dnc_check_enabled",
    "notes",
    "is_default",
    "country_code",
    "prefix",
  ];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Aucun champ valide à mettre à jour." }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("phone_numbers")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}
