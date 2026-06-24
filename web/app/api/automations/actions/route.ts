import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/automations/actions?status=pending
 *
 * The review queue: AI-drafted actions awaiting human approval (review-mode
 * workflows). Org-scoped. Secrets never appear here — only the drafted
 * subject/body/parameters.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ actions: [] });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";

  const admin = supabaseServer();
  let q = admin
    .from("org_workflow_actions")
    .select("id, workflow_id, agent_id, channel, table_name, row_id, payload, status, error, created_at, decided_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status !== "all") q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Decorate with workflow names in one extra query.
  const wfIds = Array.from(new Set((data ?? []).map((a) => a.workflow_id))).filter(Boolean) as string[];
  const names: Record<string, string> = {};
  if (wfIds.length > 0) {
    const { data: wfs } = await admin.from("org_workflows").select("id, name").in("id", wfIds);
    for (const w of wfs ?? []) names[w.id as string] = w.name as string;
  }

  return NextResponse.json({
    actions: (data ?? []).map((a) => ({ ...a, workflow_name: names[a.workflow_id as string] ?? null })),
  });
}
