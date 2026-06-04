import Link from "next/link";
import { notFound } from "next/navigation";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { HelpButton } from "@/components/help/HelpButton";
import {
  NumberDetailClient,
  type FlowOption,
  type QueueOption,
} from "@/components/numbers/NumberDetailClient";

export const dynamic = "force-dynamic";

/**
 * Per-number settings page. The list at `/numbers` exposes the same routing
 * dropdowns inline for power users; this page is the friendlier view a CSM
 * lands on when clicking a number — focused on the inbound disposition
 * (IA / IVR flow / file humaine).
 */
export default async function NumberDetailPage(ctx: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await ctx.params;
  if (!hasSupabase()) notFound();
  const sb = supabaseServer();
  const orgId = await currentOrgIdForServer();

  const { data: row } = await sb
    .from("phone_numbers")
    .select(
      "id, org_id, e164, label, active, flow_id, queue_id, agent_handle_id, webhook_configured",
    )
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();

  if (!row) notFound();

  const [{ data: flows }, { data: queues }] = await Promise.all([
    sb
      .from("flows")
      .select("id, name")
      .eq("org_id", orgId)
      .order("name", { ascending: true })
      .limit(200),
    sb
      .from("queues")
      .select("id, name")
      .eq("org_id", orgId)
      .order("name", { ascending: true })
      .limit(200),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <Link href="/numbers" style={{ color: "var(--muted)", textDecoration: "none" }}>
              Numéros
            </Link>{" "}
            <span style={{ color: "var(--muted)" }}>/</span>{" "}
            <span className="kbd">{row.e164}</span>
          </h1>
          <div className="subtitle">
            {row.label ?? "Sans label"} · {row.active ? "actif" : "inactif"}
          </div>
        </div>
        <HelpButton contextKey="numbers" />
      </div>

      <NumberDetailClient
        number={{
          id: row.id,
          e164: row.e164,
          label: row.label,
          active: row.active,
          flow_id: row.flow_id,
          queue_id: row.queue_id,
          agent_handle_id: row.agent_handle_id ?? null,
        }}
        flows={(flows ?? []) as FlowOption[]}
        queues={(queues ?? []) as QueueOption[]}
      />
    </>
  );
}
