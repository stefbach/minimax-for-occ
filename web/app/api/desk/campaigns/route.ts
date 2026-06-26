import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/campaigns
 *
 * The campaigns assigned to the signed-in human agent — i.e. campaigns whose
 * agent_handle is a `kind='human'` handle owned by this user, in the active
 * org. Drives the "Mes campagnes" panel on /desk where the agent flips a
 * campaign between running (the dialer sends the pre-call SMS/WhatsApp and
 * dials leads to the agent's softphone) and paused.
 *
 * Returns running/paused/draft campaigns only — a finished or cancelled
 * campaign isn't something the agent toggles.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ campaigns: [] });

  const sbSession = await supabaseSession();
  const { data: auth } = await sbSession.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  // This user's human handle(s) in the active org.
  const { data: handles } = await admin
    .from("agent_handles")
    .select("id, display_name")
    .eq("org_id", orgId)
    .eq("kind", "human")
    .eq("user_id", user.id);
  const handleIds = (handles ?? []).map((h) => h.id as string);
  if (handleIds.length === 0) return NextResponse.json({ campaigns: [] });

  const { data: campaigns, error } = await admin
    .from("campaigns")
    .select("id, name, description, state, mode, agent_handle_id, schedule, max_concurrency, metadata, created_at")
    .eq("org_id", orgId)
    .in("agent_handle_id", handleIds)
    .in("state", ["draft", "scheduled", "running", "paused"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Cheap progress aggregate per campaign (pending vs done/answered).
  const ids = (campaigns ?? []).map((c) => c.id as string);
  const counts: Record<string, { total: number; done: number; pending: number }> = {};
  if (ids.length > 0) {
    const { data: targets } = await admin
      .from("campaign_targets")
      .select("campaign_id, status")
      .in("campaign_id", ids);
    for (const t of targets ?? []) {
      const id = t.campaign_id as string;
      const c = counts[id] ?? { total: 0, done: 0, pending: 0 };
      c.total += 1;
      if (t.status === "done" || t.status === "answered") c.done += 1;
      if (t.status === "pending" || t.status === "dialing") c.pending += 1;
      counts[id] = c;
    }
  }

  const result = (campaigns ?? []).map((c) => {
    const meta = (c.metadata ?? {}) as { precall_message?: { sms?: unknown; whatsapp?: unknown } };
    const pre = meta.precall_message ?? null;
    return {
      id: c.id as string,
      name: c.name as string,
      description: (c.description as string | null) ?? null,
      state: c.state as string,
      mode: c.mode as string,
      schedule: c.schedule ?? null,
      precall: pre ? { sms: Boolean(pre.sms), whatsapp: Boolean(pre.whatsapp) } : null,
      target_total: counts[c.id as string]?.total ?? 0,
      target_done: counts[c.id as string]?.done ?? 0,
      target_pending: counts[c.id as string]?.pending ?? 0,
    };
  });

  return NextResponse.json({ campaigns: result });
}
