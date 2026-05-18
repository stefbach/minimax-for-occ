import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/agents/[id]/prompt-versions/[v]/restore
 *
 * Rolls (system_prompt, greeting) of the agent back to the requested
 * historical version. Before applying, snapshots the agent's CURRENT
 * prompt as a new version (so the rollback itself is reversible).
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; v: string }> }
) {
  const { id, v } = await ctx.params;
  const versionNum = Number(v);
  if (!Number.isFinite(versionNum) || versionNum < 1) {
    return NextResponse.json({ error: "invalid version" }, { status: 400 });
  }

  const sb = supabaseServer();

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
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, agent: data, restored_version: versionNum });
}
