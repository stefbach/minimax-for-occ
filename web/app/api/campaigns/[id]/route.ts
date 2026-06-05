import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATES = new Set([
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "cancelled",
]);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  // KPI counts. campaign_targets has no org_id column — the parent
  // campaign row above is already org-filtered, so restricting by
  // campaign_id is sufficient.
  const { data: targets } = await sb
    .from("campaign_targets")
    .select("status")
    .eq("campaign_id", id);
  const counts: Record<string, number> = {};
  for (const t of targets ?? []) {
    const k = (t.status as string) ?? "pending";
    counts[k] = (counts[k] ?? 0) + 1;
  }

  // Resolve agent + phone number for display.
  let agent_handle: { id: string; display_name: string; kind: string; ai_agent_id: string | null } | null = null;
  if (data.agent_handle_id) {
    const { data: ah } = await sb
      .from("agent_handles")
      .select("id,display_name,kind,ai_agent_id")
      .eq("id", data.agent_handle_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (ah) agent_handle = ah as any;
  }
  let phone_number: { id: string; e164: string; label: string | null } | null = null;
  if (data.phone_number_id) {
    const { data: pn } = await sb
      .from("phone_numbers")
      .select("id,e164,label")
      .eq("id", data.phone_number_id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (pn) phone_number = pn as any;
  }

  // Phase 4: resolve linked script (name + mission) if any. We swallow
  // errors silently so older deploys (without the 0016 migration) keep
  // working: campaigns.script_id may simply be absent.
  let script: { id: string; name: string; mission: string | null } | null = null;
  const scriptId = (data as Record<string, unknown>).script_id as string | undefined;
  if (scriptId) {
    const { data: sc } = await sb
      .from("scripts")
      .select("id,name,mission")
      .eq("id", scriptId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (sc) script = sc as { id: string; name: string; mission: string | null };
  }

  return NextResponse.json({ ...data, counts, agent_handle, phone_number, script });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "body requis" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  const writable = [
    "name",
    "description",
    "agent_handle_id",
    "phone_number_id",
    "caller_id_e164",
    "schedule",
    "max_concurrency",
    "max_attempts",
    "retry_delay_min",
    "amd_enabled",
    "metadata",
    "data_table_id",
    // Phase 4: mission + script + agent team (no FK on agent_team_id).
    "mission",
    "script_id",
    "agent_team_id",
  ];
  for (const k of writable) {
    if (k in body) patch[k] = body[k];
  }
  if ("state" in body) {
    const s = String(body.state);
    if (!ALLOWED_STATES.has(s)) {
      return NextResponse.json({ error: `state invalide: ${s}` }, { status: 400 });
    }
    patch.state = s;
  }
  patch.updated_at = new Date().toISOString();

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("campaigns")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  if ("state" in body) {
    await sb.from("event_log").insert({
      org_id: data.org_id,
      actor_kind: "system",
      entity: "campaign",
      entity_id: id,
      action: `state:${patch.state}`,
      payload: {},
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { error } = await sb
    .from("campaigns")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
