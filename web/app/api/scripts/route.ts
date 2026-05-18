import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScriptStep = {
  step?: number;
  title?: string;
  content?: string;
  branches?: Array<{ label?: string; goto?: number | string }>;
  [k: string]: unknown;
};

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("scripts")
    .select("id, org_id, name, mission, description, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Latest version metadata in a single follow-up query.
  const ids = (data ?? []).map((s) => s.id as string);
  const latest: Record<string, { version: number; created_at: string }> = {};
  if (ids.length > 0) {
    const { data: vers } = await sb
      .from("script_versions")
      .select("script_id, version, created_at")
      .in("script_id", ids)
      .order("version", { ascending: false });
    for (const v of vers ?? []) {
      const sid = v.script_id as string;
      if (!latest[sid]) {
        latest[sid] = {
          version: v.version as number,
          created_at: v.created_at as string,
        };
      }
    }
  }

  return NextResponse.json(
    (data ?? []).map((s) => ({
      ...s,
      latest_version: latest[s.id as string]?.version ?? null,
      latest_version_at: latest[s.id as string]?.created_at ?? null,
    })),
  );
}

export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const orgId = await requestOrgId(req);
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    mission?: string | null;
    description?: string | null;
    steps?: ScriptStep[];
  } | null;
  if (!body?.name) {
    return NextResponse.json({ error: "name requis" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data: script, error } = await sb
    .from("scripts")
    .insert({
      org_id: orgId,
      name: body.name,
      mission: body.mission ?? null,
      description: body.description ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Seed an initial version (v1) with whatever steps were provided, or an
  // empty array so the editor always has something to load.
  const session = await supabaseSession();
  const { data: userData } = await session.auth.getUser();
  const createdBy = userData?.user?.id ?? null;

  const { error: vErr } = await sb.from("script_versions").insert({
    script_id: script.id,
    version: 1,
    steps: Array.isArray(body.steps) ? body.steps : [],
    created_by: createdBy,
    note: "version initiale",
  });
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  return NextResponse.json(script, { status: 201 });
}
