import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { currentMembership, currentUser } from "@/lib/supabase-auth";
import { executeAction } from "@/lib/copilot/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const m = await currentMembership();
  if (!m || m.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;

  // Make sure the action belongs to this user (defense in depth — RLS already blocks others).
  const sb = supabaseServer();
  const { data: row } = await sb
    .from("copilot_actions")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if ((row as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const out = await executeAction(id, { userId: user.id, orgId: m.org_id ?? null });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
  return NextResponse.json({ ok: true, result: out.result });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const m = await currentMembership();
  if (!m || m.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { error } = await sb
    .from("copilot_actions")
    .update({ status: "rejected" })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "pending");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
