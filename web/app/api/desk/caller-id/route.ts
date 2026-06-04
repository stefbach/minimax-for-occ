import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/caller-id
 *
 * Returns `{ e164, source }` — the phone_numbers row to use as the From
 * caller-ID when the human agent dials from /desk.
 *
 *   - First, the row tagged metadata->>role = 'human'.
 *   - Otherwise, the first active twilio row that isn't already in use as
 *     a campaign caller-ID (campaigns.phone_number_id).
 *   - Otherwise, the org's is_default number.
 *   - Otherwise, any active number (alphabetical first).
 *
 * Falls back to { e164: null } if the org owns no usable number — the
 * Softphone then lets Twilio's TwiML default (the account verified
 * outbound number) take over, same as today.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ e164: null, source: "no-db" });

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

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
      return NextResponse.json({ e164: data[0].e164, source: "metadata.role=human" });
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
        source: free.is_default ? "is_default" : "fallback-free",
      });
    }
    // Every number is a campaign CID — fall back to the org default anyway,
    // because not having a caller-ID at all is worse than re-using one.
    return NextResponse.json({ e164: actives[0].e164, source: "fallback-default" });
  }

  return NextResponse.json({ e164: null, source: "none" });
}
