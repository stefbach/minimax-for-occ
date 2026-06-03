import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; stepId: string }> },
) {
  const { id: flowId, stepId } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();

  // Verify the parent flow belongs to this org first; flow_steps inherits
  // tenancy via flow_id (no org_id column).
  const { data: flow } = await sb
    .from("flows")
    .select("start_step_id")
    .eq("id", flowId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!flow) return NextResponse.json({ error: "flow not found" }, { status: 404 });

  // If this step is the flow's start_step_id, clear it first to avoid dangling ref.
  if (flow.start_step_id === stepId) {
    await sb
      .from("flows")
      .update({ start_step_id: null })
      .eq("id", flowId)
      .eq("org_id", orgId);
  }

  const { error } = await sb
    .from("flow_steps")
    .delete()
    .eq("id", stepId)
    .eq("flow_id", flowId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
