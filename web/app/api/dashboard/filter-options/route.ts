import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { leadsTableFor, type LeadsSource } from "@/lib/leads-source";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Options for the global filter bar's Agent and Source dropdowns. Agents come
// from the org's agent_handles; sources from the distinct source_lead values
// of the selected leads table (empty for tenants without one — the UI hides
// the dropdown when there is nothing to pick).

export type FilterOptionsResponse = { agents: string[]; sources: string[] };

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const leadsSource: LeadsSource = searchParams.get("leads_source") === "test" ? "test" : "prod";
  const sb = supabaseServer();

  const agents = new Set<string>();
  {
    const { data } = await sb
      .from("agent_handles")
      .select("display_name")
      .eq("org_id", orgId)
      .not("display_name", "is", null)
      .limit(500);
    for (const a of (data ?? []) as { display_name: string | null }[]) {
      if (a.display_name?.trim()) agents.add(a.display_name.trim());
    }
  }

  const sources = new Set<string>();
  try {
    const table = leadsTableFor(leadsSource);
    const { rows, error } = await fetchAllPaged<{ source_lead: string | null }>(() =>
      sb
        .from(table as never)
        .select("source_lead")
        .not("source_lead", "is", null) as unknown as Rangeable<{ source_lead: string | null }>,
    );
    if (!error) {
      for (const r of rows) {
        const s = (r.source_lead ?? "").trim();
        if (s) sources.add(s);
      }
    }
  } catch {
    /* tenant without a leads table — sources stay empty */
  }

  const body: FilterOptionsResponse = {
    agents: [...agents].sort((a, b) => a.localeCompare(b)),
    sources: [...sources].sort((a, b) => a.localeCompare(b)),
  };
  return NextResponse.json(body);
}
