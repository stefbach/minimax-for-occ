import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { getAssignedOutboundNumbers } from "@/lib/outbound-numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/caller-id
 *
 * Returns `{ e164, numbers, source }` — the caller-ID(s) the human agent may
 * use as the From when dialling from /desk.
 *
 *   - FIRST: the numbers ASSIGNED to this agent (outbound_number_agents). When
 *     present, the agent is restricted to these — `e164` is their primary and
 *     `numbers` lists every number they may pick in the softphone.
 *   - Otherwise (no assignment) the org-wide fallback, returned as a single
 *     option so the agent still has a working caller-ID:
 *       · the row tagged metadata->>role = 'human', else
 *       · the first active twilio row not used as a campaign caller-ID, else
 *       · the org is_default number, else any active number.
 *
 * Falls back to { e164: null, numbers: [] } if the org owns no usable number —
 * the Softphone then lets Twilio's TwiML default take over, same as today.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ e164: null, numbers: [], source: "no-db" });

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  // 0. Numbers explicitly assigned to THIS agent — the restriction layer.
  //    When set, the agent may only dial out from one of these.
  {
    const assigned = await getAssignedOutboundNumbers(admin, orgId, auth.user.id);
    if (assigned.length > 0) {
      const primary = assigned.find((n) => n.is_primary) ?? assigned[0];
      return NextResponse.json({
        e164: primary.e164,
        numbers: assigned.map((n) => ({ e164: n.e164, label: n.label, is_primary: n.is_primary })),
        source: "agent-assigned",
      });
    }
  }

  // 1. Tagged human number.
  {
    const { data } = await admin
      .from("phone_numbers")
      .select("e164, metadata")
      .eq("org_id", orgId)
      .eq("active", true)
      .filter("metadata->>role", "eq", "human")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    if (data && data.length > 0) {
      return NextResponse.json({ e164: data[0].e164, numbers: [], source: "metadata.role=human" });
    }
  }

  // 2. Active twilio number not used by any campaign.
  const { data: usedByCampaign } = await admin
    .from("campaigns")
    .select("phone_number_id")
    .eq("org_id", orgId)
    .not("phone_number_id", "is", null);
  const excluded = new Set(
    (usedByCampaign ?? [])
      .map((r) => (r as { phone_number_id: string | null }).phone_number_id)
      .filter((v): v is string => Boolean(v)),
  );

  const { data: actives } = await admin
    .from("phone_numbers")
    .select("id, e164, is_default")
    .eq("org_id", orgId)
    .eq("provider", "twilio")
    .eq("active", true)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(50);

  if (actives && actives.length > 0) {
    const free = actives.find((r) => !excluded.has(r.id));
    if (free) {
      return NextResponse.json({
        e164: free.e164,
        numbers: [],
        source: free.is_default ? "is_default" : "fallback-free",
      });
    }
    // Every number is a campaign CID — fall back to the org default anyway,
    // because not having a caller-ID at all is worse than re-using one.
    return NextResponse.json({ e164: actives[0].e164, numbers: [], source: "fallback-default" });
  }

  return NextResponse.json({ e164: null, numbers: [], source: "none" });
}
