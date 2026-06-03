import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/agents/[id]/prompt-versions/[v]/restore
 *
 * Rolls (system_prompt, greeting) of the agent back to the requested
 * historical version. Before applying, snapshots the agent's CURRENT
 * prompt as a new version (so the rollback itself is reversible).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; v: string }> }
) {
  const { id, v } = await ctx.params;
  const versionNum = Number(v);
  if (!Number.isFinite(versionNum) || versionNum < 1) {
    return NextResponse.json({ error: "invalid version" }, { status: 400 });
  }

  const orgId = await requestOrgId(req);
  const sb = supabaseServer();

  // Verify parent agent belongs to this org. prompt_versions has no org_id
  // column — tenancy inherits via agent_id.
  const { data: parentAgent } = await sb
    .from("agents")
    .select("id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!parentAgent) return NextResponse.json({ error: "agent not found" }, { status: 404 });

  // 1. Fetch target historical version.
  const { data: target, error: targetErr } = await sb
    .from("prompt_versions")
    .select("system_prompt, greeting")
    .eq("agent_id", id)
    .eq("version", versionNum)
    .maybeSingle();
  if (targetErr) return NextResponse.json({ error: targetErr.message }, { status: 500 });
  if (!target) return NextResponse.json({ error: "version not found" }, { status: 404 });

  // 2. Snapshot current state as a NEW version (auto-bumped) so the rollback
  //    is itself recorded and reversible.
  const { data: current } = await sb
    .from("agents")
    .select("system_prompt, greeting")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  const { data: last } = await sb
    .from("prompt_versions")
    .select("version")
    .eq("agent_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((last?.version as number | undefined) ?? 0) + 1;

  await sb.from("prompt_versions").insert({
    agent_id: id,
    version: nextVersion,
    system_prompt: (current?.system_prompt as string | null) ?? "",
    greeting: (current?.greeting as string | null) ?? null,
    note: `auto-snapshot before restore to v${versionNum}`,
  });

  // 3. Apply the historical values to the live agent row.
  const { data, error } = await sb
    .from("agents")
    .update({
      system_prompt: target.system_prompt,
      greeting: target.greeting,
    })
    .eq("id", id)
    .eq("org_id", orgId)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "agent not found" }, { status: 404 });

  return NextResponse.json({ ok: true, agent: data, restored_version: versionNum });
}
