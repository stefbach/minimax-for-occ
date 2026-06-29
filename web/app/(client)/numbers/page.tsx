import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { hasTwilio } from "@/lib/twilio";
import { HelpButton } from "@/components/help/HelpButton";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import {
  NumbersClient,
  type PhoneNumberRow,
  type FlowOption,
  type QueueOption,
  type AgentOption,
} from "@/components/numbers/NumbersClient";

export const dynamic = "force-dynamic";

export default async function NumbersPage() {
  let initial: PhoneNumberRow[] = [];
  let flows: FlowOption[] = [];
  let queues: QueueOption[] = [];
  let agents: AgentOption[] = [];

  if (hasSupabase()) {
    const sb = supabaseServer();
    const orgId = await currentOrgIdForServer();
    try {
      const { data } = await sb
        .from("phone_numbers")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500);
      initial = (data ?? []) as PhoneNumberRow[];
    } catch {
      /* table might not exist yet — start empty */
    }
    try {
      const { data } = await sb
        .from("flows")
        .select("id, name")
        .eq("org_id", orgId)
        .order("name", { ascending: true })
        .limit(200);
      flows = (data ?? []) as FlowOption[];
    } catch {
      /* flows table may be empty */
    }
    try {
      const { data } = await sb
        .from("queues")
        .select("id, name")
        .eq("org_id", orgId)
        .order("name", { ascending: true })
        .limit(200);
      queues = (data ?? []) as QueueOption[];
    } catch {
      /* queues table may be empty */
    }
    try {
      const { data } = await sb
        .from("agent_handles")
        .select("id, display_name, kind")
        .eq("org_id", orgId)
        .order("display_name", { ascending: true })
        .limit(200);
      agents = (data ?? []) as AgentOption[];
    } catch {
      /* agent_handles may be empty */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Phone numbers</h1>
          <div className="subtitle">
            {initial.length} number{initial.length === 1 ? "" : "s"} provisioned via Twilio
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/numbers/health" className="button" style={{ textDecoration: "none" }}>
            Number health
          </Link>
          <HelpButton contextKey="numbers" />
        </div>
      </div>

      {!hasTwilio() && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--bad)" }}>
          <h3 style={{ marginTop: 0, color: "var(--bad)" }}>Twilio not configured</h3>
          <p className="muted" style={{ margin: 0 }}>
            Set <span className="kbd">TWILIO_ACCOUNT_SID</span> and{" "}
            <span className="kbd">TWILIO_AUTH_TOKEN</span> in your Vercel environment variables
            to search and purchase numbers. Search and purchase are disabled until these
            variables are present.
          </p>
        </div>
      )}

      <NumbersClient
        initial={initial}
        flows={flows}
        queues={queues}
        agents={agents}
        twilioReady={hasTwilio()}
      />
    </>
  );
}
