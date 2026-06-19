import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/automations/runs/:runId → { log: LogEntry[] } for the given run. */
export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ log: [] });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { runId } = await params;
  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  // Verify the run belongs to a workflow of this org.
  const { data: run, error } = await admin
    .from("org_workflow_runs")
    .select("id, log, workflow_id")
    .eq("id", runId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: wf } = await admin
    .from("org_workflows")
    .select("id")
    .eq("id", run.workflow_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!wf) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  return NextResponse.json({ log: run.log ?? [] });
}
