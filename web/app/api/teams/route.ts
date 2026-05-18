import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/teams — list teams for the current org. */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("agent_teams")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** POST /api/teams — create a new team. */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const orgId = await requestOrgId(req);
  const body = (await req.json()) as {
    name: string;
    description?: string | null;
    lead_agent_id?: string | null;
  };
  if (!body.name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("agent_teams")
    .insert({
      org_id: orgId,
      name: body.name,
      description: body.description ?? null,
      lead_agent_id: body.lead_agent_id ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
