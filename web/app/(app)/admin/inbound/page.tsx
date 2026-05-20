import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { InboundConnectorsClient } from "@/components/admin/InboundConnectorsClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

import { LEGACY_ORG_ID as DEFAULT_ORG } from "@/lib/constants";

export default async function InboundConnectorsPage() {
  let org: { id: string; name: string } | null = null;
  let campaigns: Array<{ id: string; name: string }> = [];

  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const { data } = await sb
        .from("organizations")
        .select("id, name")
        .eq("id", DEFAULT_ORG)
        .maybeSingle();
      org = data ?? null;

      const { data: camps } = await sb
        .from("campaigns")
        .select("id, name")
        .eq("org_id", DEFAULT_ORG)
        .order("created_at", { ascending: false })
        .limit(200);
      campaigns = (camps ?? []) as Array<{ id: string; name: string }>;
    } catch {
      /* tables might not exist yet */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Connecteurs entrants</h1>
          <div className="subtitle">
            Génère un secret par connecteur (Google Ads, Facebook Lead Ads,
            Google Sheets) et colle l&apos;URL + le secret dans n8n.
          </div>
        </div>
        <HelpButton contextKey="admin.inbound" />
      </div>
      <InboundConnectorsClient
        orgId={org?.id ?? DEFAULT_ORG}
        campaigns={campaigns}
      />
    </>
  );
}
