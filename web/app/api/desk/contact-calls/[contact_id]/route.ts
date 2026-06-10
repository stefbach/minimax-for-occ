import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/contact-calls/[contact_id]?limit=10
 *
 * Recent calls for a contact — used by the PatientDrawer to show call
 * history in the CRM-style detail view. Always scoped to the caller's
 * org_id; ordered by started_at desc; default limit 10, max 50.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ contact_id: string }> },
) {
  if (!hasSupabase()) return NextResponse.json({ calls: [] });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { contact_id } = await ctx.params;
  if (!contact_id) return NextResponse.json({ error: "contact_id required" }, { status: 400 });

  const orgId = await requestOrgId(req);
  if (!orgId) return NextResponse.json({ calls: [] });
  const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 10)));

  const admin = supabaseServer();
  const { data, error } = await admin
    .from("calls")
    .select("id, started_at, duration_secs, direction, summary, metadata, agent_handles(display_name)")
    .eq("org_id", orgId)
    .eq("contact_id", contact_id)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    calls: (data ?? []).map((r) => {
      const meta = (r.metadata ?? {}) as { qualification?: string };
      const handles = r.agent_handles as { display_name?: string } | { display_name?: string }[] | null;
      const handle = Array.isArray(handles) ? handles[0] : handles;
      return {
        id: r.id,
        started_at: r.started_at,
        duration_secs: r.duration_secs,
        direction: r.direction,
        summary: r.summary,
        qualification: meta.qualification ?? null,
        agent_name: handle?.display_name ?? null,
      };
    }),
  });
}
