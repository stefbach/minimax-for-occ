import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { GuidedStartClient } from "@/components/start/GuidedStartClient";

export const dynamic = "force-dynamic";

async function count(table: string, orgId: string, extra?: (q: any) => any): Promise<number> {
  try {
    const sb = supabaseServer();
    let q = sb.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId);
    if (extra) q = extra(q);
    const { count: c } = await q;
    return c ?? 0;
  } catch {
    return 0;
  }
}

export default async function GuidedStartPage({
  searchParams,
}: {
  searchParams?: Promise<{ scenario?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const counts = { agents: 0, tables: 0, contacts: 0, campaigns: 0, numbers: 0, flows: 0, scripts: 0 };

  if (hasSupabase()) {
    const orgId = await currentOrgIdForServer();
    const [agents, tables, contacts, campaigns, numbers, flows, scripts] = await Promise.all([
      count("agent_handles", orgId, (q) => q.eq("kind", "ai").eq("active", true)),
      count("tenant_data_tables", orgId),
      count("contacts", orgId),
      count("campaigns", orgId),
      count("phone_numbers", orgId),
      count("flows", orgId),
      count("scripts", orgId),
    ]);
    Object.assign(counts, { agents, tables, contacts, campaigns, numbers, flows, scripts });
  }

  let role: string | null = null;
  if (hasSupabase()) {
    try {
      const orgId = await currentOrgIdForServer();
      const { currentRoleInOrg } = await import("@/lib/supabase-auth");
      role = await currentRoleInOrg(orgId);
    } catch { /* fall back to MGMT_SCENARIOS */ }
  }

  const selectedId = sp.scenario ?? "campaign";

  return <GuidedStartClient counts={counts} role={role} selectedId={selectedId} />;
}
