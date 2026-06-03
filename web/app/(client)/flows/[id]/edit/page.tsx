import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { FlowEditor, type FlowFull, type Step, type Edge } from "./FlowEditor";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

async function loadFlow(id: string): Promise<FlowFull | null> {
  if (!hasSupabase()) return null;
  const orgId = await currentOrgIdForServer();
  const sb = supabaseServer();
  const { data: flow } = await sb
    .from("flows")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!flow) return null;
  // flow_steps / flow_edges inherit org via flow_id; the flows row above
  // is already org-filtered, so we trust the parent's tenancy here.
  const { data: steps } = await sb
    .from("flow_steps")
    .select("*")
    .eq("flow_id", id)
    .order("created_at", { ascending: true });
  const { data: edges } = await sb
    .from("flow_edges")
    .select("*")
    .eq("flow_id", id)
    .order("position", { ascending: true });
  return {
    ...(flow as Omit<FlowFull, "steps" | "edges">),
    steps: (steps as Step[]) ?? [],
    edges: (edges as Edge[]) ?? [],
  };
}

export default async function FlowEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const flow = await loadFlow(id);
  if (!flow) notFound();

  return (
    <div style={{ marginTop: -28, marginLeft: -32, marginRight: -32, marginBottom: -60 }}>
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "var(--bg-2)",
        }}
      >
        <Link href="/flows" style={{ color: "var(--muted)", fontSize: 13 }}>
          ← Flows
        </Link>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{flow.name}</div>
          {flow.description && (
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{flow.description}</div>
          )}
        </div>
        <HelpButton contextKey="flows" />
      </div>
      <FlowEditor flow={flow} />
    </div>
  );
}
