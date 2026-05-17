import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { ingestTargets } from "@/lib/campaign-targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json([]);
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("campaign_targets")
    .select(
      "id,campaign_id,contact_id,status,attempts,last_attempt_at,next_attempt_at,last_call_id,payload,contacts(e164,display_name)",
    )
    .eq("campaign_id", id)
    .order("status", { ascending: true })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    contacts?: Array<{ e164: string; name?: string | null }>;
  } | null;
  if (!body?.contacts || body.contacts.length === 0) {
    return NextResponse.json({ error: "contacts requis" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data: campaign, error: cErr } = await sb
    .from("campaigns")
    .select("id,org_id")
    .eq("id", id)
    .single();
  if (cErr || !campaign) {
    return NextResponse.json({ error: cErr?.message ?? "campagne introuvable" }, { status: 404 });
  }

  try {
    const result = await ingestTargets(sb, campaign.org_id as string, id, body.contacts);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur upsert targets" },
      { status: 500 },
    );
  }
}
