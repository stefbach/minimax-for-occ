import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: flowId } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json()) as {
    from_step_id?: string;
    to_step_id?: string;
    condition?: Record<string, unknown>;
    position?: number;
  };
  if (!body.from_step_id || !body.to_step_id) {
    return NextResponse.json({ error: "from_step_id and to_step_id required" }, { status: 400 });
  }
  // Verify the parent flow belongs to the caller's org before letting them
  // attach edges that would inherit its flow_id (flow_edges has no org_id
  // column — it inherits tenancy via flow_id).
  const { data: parentFlow } = await sb
    .from("flows")
    .select("id")
    .eq("id", flowId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!parentFlow) return NextResponse.json({ error: "flow not found" }, { status: 404 });
  const { data, error } = await sb
    .from("flow_edges")
    .insert({
      flow_id: flowId,
      from_step_id: body.from_step_id,
      to_step_id: body.to_step_id,
      condition: body.condition ?? { kind: "always" },
      position: body.position ?? 0,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: flowId } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const url = new URL(req.url);
  const edgeId = url.searchParams.get("id");
  if (!edgeId) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  // Verify the parent flow belongs to this org first; flow_edges inherits
  // its tenancy via flow_id (no org_id column).
  const { data: parentFlow } = await sb
    .from("flows")
    .select("id")
    .eq("id", flowId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!parentFlow) return NextResponse.json({ error: "flow not found" }, { status: 404 });

  const { error } = await sb
    .from("flow_edges")
    .delete()
    .eq("id", edgeId)
    .eq("flow_id", flowId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
