import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { bucketForCall } from "@/lib/qualification";
import { callInLeadsScope, leadsScopeFor, type LeadsSource } from "@/lib/leads-source";
import { isPhantomCall, isSoftphoneTestLeg } from "@/lib/call-quality";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HandoffCall = {
  id: string;
  phone: string | null;
  contact_name: string | null;
  bucket: "passer_humain" | "suivi_requis";
  reason: string | null;
  summary: string | null;
  called_at: string | null;
  duration_secs: number | null;
  confidence: number | null;
};

export type LeadsHandoffResponse = {
  calls: HandoffCall[];
  total: number;
  window_hours: number;
};

type Row = {
  id: string;
  to_e164: string | null;
  started_at: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  state: string | null;
  summary: string | null;
  metadata: {
    qualification?: string | null;
    qualification_ai?: { reason?: string | null; confidence?: number | null } | null;
    source?: string | null;
  } | null;
  contacts?: { display_name: string | null } | null;
};

const ACTIVE = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) return NextResponse.json({ error: "module_forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const windowHours = Math.min(Number(searchParams.get("hours") ?? "48"), 168); // cap at 7 days
  const leadsSource: LeadsSource = searchParams.get("leads_source") === "test" ? "test" : "prod";

  const since = new Date(Date.now() - windowHours * 3600_000);
  const sb = supabaseServer();

  const { rows, error } = await fetchAllPaged<Row>(() =>
    sb
      .from("calls")
      .select("id, to_e164, started_at, answered_at, duration_secs, disposition, state, summary, metadata, contacts(display_name)")
      .eq("org_id", orgId)
      .gte("started_at", since.toISOString())
      .not("answered_at", "is", null)
      .order("started_at", { ascending: false }) as unknown as Rangeable<Row>,
  );
  if (error) return NextResponse.json({ error }, { status: 500 });

  const scope = await leadsScopeFor(leadsSource);

  const calls: HandoffCall[] = (rows ?? [])
    .filter(
      (r) =>
        !ACTIVE.has(r.state ?? "")
        && !isPhantomCall(r as never)
        && !isSoftphoneTestLeg(r as never)
        && callInLeadsScope(r.to_e164, scope),
    )
    .filter((r) => {
      const b = bucketForCall(r as never);
      return b === "passer_humain" || b === "suivi_requis";
    })
    .map((r) => {
      const b = bucketForCall(r as never) as "passer_humain" | "suivi_requis";
      const ai = r.metadata?.qualification_ai;
      return {
        id: r.id,
        phone: r.to_e164,
        contact_name: r.contacts?.display_name ?? null,
        bucket: b,
        reason: ai?.reason ?? null,
        summary: r.summary ?? null,
        called_at: r.started_at,
        duration_secs: r.duration_secs,
        confidence: ai?.confidence ?? null,
      };
    });

  return NextResponse.json({
    calls,
    total: calls.length,
    window_hours: windowHours,
  } satisfies LeadsHandoffResponse);
}
