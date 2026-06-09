import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List agent_handles for the current org. Used by the campaign edit modal
// to populate the "Agent principal" dropdown — campaigns reference
// agent_handle_id, not agents.id, so the modal needs the handle list
// (each handle wraps either an AI agent or a human user).
export async function GET(req: Request) {
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("agent_handles")
    .select("id, display_name, kind, ai_agent_id, user_id")
    .eq("org_id", orgId)
    .order("display_name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
