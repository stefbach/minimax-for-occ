import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { bucketForCall, type QualBucket } from "@/lib/qualification";
import { isInbound, normalizeDirectionForDb } from "@/lib/call-direction";
import { callInLeadsScope, leadsScopeFor, leadNameMapFor, leadNameForPhone, type LeadsSource } from "@/lib/leads-source";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";
import { callMatchesSystem, parseCallSystem } from "@/lib/call-system";
import { slotForDate } from "@/lib/call-slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single endpoint that powers EVERY drill-down on the dashboard. Takes the
// period + a typed filter set (which KPI / card was clicked) and returns the
// matching calls in a light shape suitable for a slide-over list. One endpoint
// keeps cache, RLS and qualification logic in one place — clients never re-
// implement bucketing.

const ACTIVE = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);

export type DrillCall = {
  id: string;
  started_at: string | null;
  direction: string | null;
  duration_secs: number | null;
  answered: boolean;
  qualification: QualBucket;
  contact_name: string | null;
  agent_name: string | null;
  phone: string | null;
  disposition: string | null;
};

export type DrillResponse = {
  total: number;
  returned: number;
  truncated: boolean;
  calls: DrillCall[];
};

type Row = {
  id: string;
  direction: string | null;
  state: string | null;
  answered_at: string | null;
  started_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  agent_handle_id: string | null;
  from_e164: string | null;
  to_e164: string | null;
  metadata: { qualification?: string | null } | null;
  agent_handles?: { display_name: string | null } | null;
  contacts?: { display_name: string | null; e164: string | null } | null;
};

function inDurationBucket(secs: number, bucket: string): boolean {
  switch (bucket) {
    case "lt15s": return secs < 15;
    case "s15_60": return secs >= 15 && secs < 60;
    case "m1_2": return secs >= 60 && secs < 120;
    case "m2_3": return secs >= 120 && secs < 180;
    case "m3_5": return secs >= 180 && secs < 300;
    case "gt5m": return secs >= 300;
    default: return true;
  }
}

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const now = new Date();
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;
  const from = searchParams.get("from")
    ? new Date(searchParams.get("from")!)
    : new Date(now.getTime() - 7 * 86400_000);
  const direction = searchParams.get("direction"); // all|in|out
  const qualParam = searchParams.get("qualification"); // QualBucket | unqualified | null
  const answered = searchParams.get("answered"); // yes|no|null
  const durationBucket = searchParams.get("duration_bucket");
  const slot = searchParams.get("slot");
  const minDuration = Number(searchParams.get("min_duration") ?? 0);
  const inboundOnly = searchParams.get("inbound_only") === "1";
  // Same Prod/Test scoping as the rest of the dashboard so a drill-down on
  // "Prod totals" doesn't list Test calls (and vice-versa).
  const leadsSource: LeadsSource = searchParams.get("leads_source") === "test" ? "test" : "prod";
  const system = parseCallSystem(searchParams.get("system"));

  const sb = supabaseServer();
  const dbDir = normalizeDirectionForDb(direction);
  // Paged past the 1000-row cap so wide-period drill-downs see every call.
  const { rows: data, error } = await fetchAllPaged<Row>(
    () => {
      let q = sb
        .from("calls")
        .select(
          "id, direction, state, answered_at, started_at, duration_secs, disposition, agent_handle_id, from_e164, to_e164, metadata, agent_handles(display_name), contacts(display_name, e164)",
        )
        .eq("org_id", orgId)
        .gte("started_at", from.toISOString())
        .lte("started_at", to.toISOString())
        .order("started_at", { ascending: false });
      if (dbDir) q = q.eq("direction", dbDir);
      return q as unknown as Rangeable<Row>;
    },
    { maxRows: 20000 },
  );
  if (error) return NextResponse.json({ error }, { status: 500 });

  const [scope, leadNames] = await Promise.all([
    leadsScopeFor(leadsSource),
    leadNameMapFor(leadsSource),
  ]);
  const rows = ((data ?? []) as unknown as Row[])
    .filter((r) => !ACTIVE.has(r.state ?? ""))
    .filter((r) => callInLeadsScope(r.to_e164, scope))
    .filter((r) => callMatchesSystem((r.metadata as { source?: string } | null)?.source, system));

  // Apply the per-card filters in memory — keeps the SQL universal and the
  // bucketing logic (which is non-trivial) consistent with the rest of the
  // dashboard via bucketForCall.
  const filtered = rows.filter((r) => {
    if (inboundOnly && !isInbound(r.direction)) return false;
    if (answered === "yes" && !r.answered_at) return false;
    if (answered === "no" && r.answered_at) return false;
    if (minDuration > 0 && (r.duration_secs ?? 0) <= minDuration) return false;
    if (durationBucket && !inDurationBucket(r.duration_secs ?? 0, durationBucket)) return false;
    if (slot) {
      if (!r.started_at) return false;
      if (slotForDate(new Date(r.started_at)) !== slot) return false;
    }
    if (qualParam) {
      const b = bucketForCall(r);
      if (qualParam === "unqualified") {
        if (b !== "autre") return false;
      } else if (b !== qualParam) {
        return false;
      }
    }
    return true;
  });

  const LIMIT = 100;
  const sliced = filtered.slice(0, LIMIT);
  const body: DrillResponse = {
    total: filtered.length,
    returned: sliced.length,
    truncated: filtered.length > LIMIT,
    calls: sliced.map((r) => {
      const phone = isInbound(r.direction) ? r.from_e164 : r.to_e164;
      return {
        id: r.id,
        started_at: r.started_at,
        direction: r.direction,
        duration_secs: r.duration_secs,
        answered: !!r.answered_at,
        qualification: bucketForCall(r),
        // Prefer the Axon contact; fall back to the lead name (Retell calls
        // have no contact) so the list shows people, not bare numbers.
        contact_name: r.contacts?.display_name ?? leadNameForPhone(phone, leadNames),
        agent_name: r.agent_handles?.display_name ?? null,
        phone,
        disposition: r.disposition,
      };
    }),
  };
  return NextResponse.json(body);
}
