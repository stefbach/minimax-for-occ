import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";
import { mergeScripts, type MergePart } from "@/lib/script-merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/scripts/merge
// Body: { name, mission?, description?, parts: [{ script_id, agent_handle_id? }] }
// Combines the latest version of each listed script into ONE continuous
// multi-agent script (graph form), assigning each block to its agent.
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const orgId = await requestOrgId(req);
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    mission?: string | null;
    description?: string | null;
    parts?: Array<{ script_id: string; agent_handle_id?: string | null }>;
  } | null;
  if (!body?.name) return NextResponse.json({ error: "name requis" }, { status: 400 });
  if (!Array.isArray(body.parts) || body.parts.length < 2) {
    return NextResponse.json({ error: "Sélectionnez au moins 2 scripts à fusionner." }, { status: 400 });
  }

  const sb = supabaseServer();

  // Load each part's source script (org-checked) + latest version steps, in the
  // order provided. Resolve the chosen agent's display name for edge labels.
  const parts: MergePart[] = [];
  for (const p of body.parts) {
    const { data: script } = await sb
      .from("scripts")
      .select("id,name")
      .eq("id", p.script_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!script) {
      return NextResponse.json({ error: `Script introuvable: ${p.script_id}` }, { status: 404 });
    }
    const { data: ver } = await sb
      .from("script_versions")
      .select("steps")
      .eq("script_id", p.script_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    let label = script.name as string;
    if (p.agent_handle_id) {
      const { data: h } = await sb
        .from("agent_handles")
        .select("display_name")
        .eq("id", p.agent_handle_id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (h?.display_name) label = h.display_name as string;
    }

    const part: MergePart = { steps: ver?.steps ?? [], label };
    // Only set an override when the caller explicitly chose an agent for this
    // block; otherwise keep whatever the source steps already carry.
    if (p.agent_handle_id) part.agent_handle_id = p.agent_handle_id;
    parts.push(part);
  }

  const graph = mergeScripts(parts);

  // Create the merged script + its v1.
  const { data: script, error } = await sb
    .from("scripts")
    .insert({
      org_id: orgId,
      name: body.name,
      mission: body.mission ?? "Parcours multi-agents fusionné.",
      description:
        body.description ??
        "Script continu généré en fusionnant plusieurs scripts. Chaque étape est assignée à son agent ; le relais se fait automatiquement.",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const session = await supabaseSession();
  const { data: userData } = await session.auth.getUser();

  const { error: vErr } = await sb.from("script_versions").insert({
    script_id: script.id,
    version: 1,
    steps: graph,
    created_by: userData?.user?.id ?? null,
    note: `fusion de ${parts.length} scripts`,
  });
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  return NextResponse.json(script, { status: 201 });
}
