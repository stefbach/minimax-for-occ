import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; stepId: string }> },
) {
  const { id: flowId, stepId } = await ctx.params;
  const sb = supabaseServer();

  // If this step is the flow's start_step_id, clear it first to avoid dangling ref.
  const { data: flow } = await sb
    .from("flows")
    .select("start_step_id")
    .eq("id", flowId)
    .maybeSingle();
  if (flow?.start_step_id === stepId) {
    await sb.from("flows").update({ start_step_id: null }).eq("id", flowId);
  }

  const { error } = await sb
    .from("flow_steps")
    .delete()
    .eq("id", stepId)
    .eq("flow_id", flowId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
