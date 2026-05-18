import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns everything the human softphone needs to display a "live prospect"
 * sheet alongside a call:
 *
 *  - the call row
 *  - the linked contact (if any)
 *  - the campaign + its script latest version steps (if the call came from a
 *    campaign that has a script_id)
 *  - recent interactions for the contact (last 50)
 *
 * Gracefully degrades when columns or tables are missing (e.g. the phase 4
 * migration 0016 has not been applied yet): missing fields come back as null
 * rather than the whole endpoint failing.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const sb = supabaseServer();

  const { data: call, error } = await sb
    .from("calls")
    .select(
      "id, org_id, direction, state, from_e164, to_e164, started_at, answered_at, ended_at, duration_secs, contact_id, queue_id, campaign_id, agent_handle_id, room_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !call) {
    return NextResponse.json({ error: error?.message ?? "call introuvable" }, { status: 404 });
  }

  // Contact + recent interactions ----------------------------------------
  let contact: Record<string, unknown> | null = null;
  let interactions: Array<Record<string, unknown>> = [];
  if (call.contact_id) {
    const { data: c } = await sb
      .from("contacts")
      .select("id, e164, display_name, email, tags, notes, metadata, created_at, updated_at")
      .eq("id", call.contact_id)
      .maybeSingle();
    contact = c ?? null;

    const { data: ints } = await sb
      .from("contact_interactions")
      .select("id, call_id, kind, summary, details, created_by, occurred_at")
      .eq("contact_id", call.contact_id)
      .order("occurred_at", { ascending: false })
      .limit(50);
    interactions = (ints ?? []) as Array<Record<string, unknown>>;
  }

  // Campaign + script ----------------------------------------------------
  let campaign:
    | {
        id: string;
        name: string;
        mission: string | null;
        script_id: string | null;
      }
    | null = null;
  let script:
    | {
        id: string;
        name: string;
        mission: string | null;
        version: number;
        steps: unknown;
      }
    | null = null;

  const campaignId = (call as Record<string, unknown>).campaign_id as string | null;
  if (campaignId) {
    const { data: camp } = await sb
      .from("campaigns")
      .select("id, name, mission, script_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (camp) {
      campaign = {
        id: camp.id as string,
        name: camp.name as string,
        mission: (camp as Record<string, unknown>).mission as string | null,
        script_id: (camp as Record<string, unknown>).script_id as string | null,
      };
      if (campaign.script_id) {
        const { data: sc } = await sb
          .from("scripts")
          .select("id, name, mission")
          .eq("id", campaign.script_id)
          .maybeSingle();
        const { data: ver } = await sb
          .from("script_versions")
          .select("version, steps")
          .eq("script_id", campaign.script_id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (sc && ver) {
          script = {
            id: sc.id as string,
            name: sc.name as string,
            mission: (sc as Record<string, unknown>).mission as string | null,
            version: ver.version as number,
            steps: ver.steps,
          };
        }
      }
    }
  }

  return NextResponse.json({ call, contact, campaign, script, interactions });
}
