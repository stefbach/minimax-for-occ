import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data: flows, error } = await sb
    .from("flows")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Count steps per flow
  const ids = (flows ?? []).map((f) => f.id);
  let stepCounts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: steps } = await sb
      .from("flow_steps")
      .select("flow_id")
      .in("flow_id", ids);
    for (const s of steps ?? []) {
      stepCounts[s.flow_id] = (stepCounts[s.flow_id] ?? 0) + 1;
    }
  }
  const out = (flows ?? []).map((f) => ({ ...f, step_count: stepCounts[f.id] ?? 0 }));
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const body = (await req.json()) as { name?: string; description?: string };
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  const { data, error } = await sb
    .from("flows")
    .insert({
      org_id: orgId,
      name: body.name.trim(),
      description: body.description ?? null,
      metadata: {},
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
