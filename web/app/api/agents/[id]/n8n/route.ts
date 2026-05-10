import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("agent_n8n_workflows")
    .select("*")
    .eq("agent_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const body = (await req.json()) as {
    workflow_id: string;
    workflow_name: string;
    webhook_path: string;
    description?: string;
    payload_schema?: Record<string, unknown>;
    enabled?: boolean;
  };
  if (!body.workflow_id || !body.webhook_path || !body.workflow_name) {
    return NextResponse.json(
      { error: "workflow_id, workflow_name, webhook_path required" },
      { status: 400 },
    );
  }
  const { data, error } = await sb
    .from("agent_n8n_workflows")
    .upsert(
      {
        agent_id: id,
        workflow_id: body.workflow_id,
        workflow_name: body.workflow_name,
        webhook_path: body.webhook_path,
        description: body.description ?? null,
        payload_schema: body.payload_schema ?? {},
        enabled: body.enabled ?? true,
      },
      { onConflict: "agent_id,webhook_path" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const bindingId = searchParams.get("binding_id");
  if (!bindingId) {
    return NextResponse.json({ error: "binding_id required" }, { status: 400 });
  }
  const sb = supabaseServer();
  const { error } = await sb
    .from("agent_n8n_workflows")
    .delete()
    .eq("id", bindingId)
    .eq("agent_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
