import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/agents/[id]/numbers  → { numbers: [{ id, e164, label, inbound_enabled, assigned, taken_by }] }
 * PUT  /api/agents/[id]/numbers  body { number_ids: string[] }
 *
 * "Numéros pris en charge" depuis la fiche agent : quels numéros routent
 * leurs appels ENTRANTS vers cet agent. Le lien réel est
 * phone_numbers.agent_handle_id -> le handle (kind='ai') de l'agent. Ce
 * endpoint est juste la vue inverse (côté agent) du menu déjà présent sur la
 * page Numéros de téléphone.
 */

type Sb = ReturnType<typeof supabaseServer>;

async function ensureAiHandle(sb: Sb, orgId: string, agentId: string): Promise<string> {
  const { data: existing } = await sb
    .from("agent_handles")
    .select("id")
    .eq("org_id", orgId)
    .eq("ai_agent_id", agentId)
    .eq("kind", "ai")
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  // L'agent n'a pas encore de handle (rare) → on le crée.
  const { data: agent } = await sb
    .from("agents").select("name").eq("id", agentId).eq("org_id", orgId).maybeSingle();
  const { data: created, error } = await sb
    .from("agent_handles")
    .insert({ org_id: orgId, kind: "ai", ai_agent_id: agentId, display_name: (agent as { name?: string } | null)?.name ?? "Agent" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (created as { id: string }).id;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ numbers: [] });
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();

  const { data: handle } = await sb
    .from("agent_handles").select("id")
    .eq("org_id", orgId).eq("ai_agent_id", id).eq("kind", "ai").maybeSingle();
  const handleId = (handle as { id?: string } | null)?.id ?? null;

  const { data: nums } = await sb
    .from("phone_numbers")
    .select("id, e164, label, inbound_enabled, agent_handle_id")
    .eq("org_id", orgId)
    .order("e164", { ascending: true })
    .limit(500);
  const rows = (nums ?? []) as Array<{ id: string; e164: string; label: string | null; inbound_enabled: boolean | null; agent_handle_id: string | null }>;

  // Noms des autres agents pour les numéros déjà pris ailleurs.
  const otherHandleIds = Array.from(
    new Set(rows.map((n) => n.agent_handle_id).filter((h): h is string => !!h && h !== handleId)),
  );
  const nameByHandle: Record<string, string | null> = {};
  if (otherHandleIds.length) {
    const { data: hs } = await sb.from("agent_handles").select("id, display_name").in("id", otherHandleIds);
    for (const h of (hs ?? []) as Array<{ id: string; display_name: string | null }>) nameByHandle[h.id] = h.display_name;
  }

  const numbers = rows.map((n) => ({
    id: n.id,
    e164: n.e164,
    label: n.label,
    inbound_enabled: !!n.inbound_enabled,
    assigned: !!handleId && n.agent_handle_id === handleId,
    taken_by: n.agent_handle_id && n.agent_handle_id !== handleId ? (nameByHandle[n.agent_handle_id] ?? "un autre agent") : null,
  }));
  return NextResponse.json({ numbers });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const body = (await req.json().catch(() => null)) as { number_ids?: unknown } | null;
  const numberIds = Array.isArray(body?.number_ids)
    ? (body!.number_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : null;
  if (!numberIds) return NextResponse.json({ error: "number_ids requis" }, { status: 400 });

  const sb = supabaseServer();
  const handleId = await ensureAiHandle(sb, orgId, id);

  // 1) Affecter les numéros sélectionnés à cet agent.
  if (numberIds.length) {
    const { error } = await sb
      .from("phone_numbers").update({ agent_handle_id: handleId })
      .eq("org_id", orgId).in("id", numberIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 2) Détacher les numéros qui pointaient sur cet agent mais ne sont plus cochés.
  const { data: cur } = await sb
    .from("phone_numbers").select("id").eq("org_id", orgId).eq("agent_handle_id", handleId);
  const toClear = ((cur ?? []) as Array<{ id: string }>).map((r) => r.id).filter((rid) => !numberIds.includes(rid));
  if (toClear.length) {
    const { error } = await sb
      .from("phone_numbers").update({ agent_handle_id: null })
      .eq("org_id", orgId).in("id", toClear);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, handle_id: handleId, assigned: numberIds.length });
}
