import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { isPhantomCall, isSoftphoneTestLeg } from "@/lib/call-quality";
import { callInLeadsScope, leadsTableFor, leadsScopeFor, type LeadsSource } from "@/lib/leads-source";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";
import { callMatchesSystem, parseCallSystem } from "@/lib/call-system";
import {
  parseGlobalFilters, hasActiveGlobalFilters, matchesGlobalFilters,
  buildLeadFilterIndex, buildAttemptIndex, eligibilityForPhone, EMPTY_LEAD_INDEX,
} from "@/lib/global-filters";
import { bucketForCall } from "@/lib/qualification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type LeadsStats = {
  total_unique_contacts: number;
  total_calls: number;
  avg_calls_per_contact: number;
  rdv_confirmed: number;
  rdv_transfer: number;
  calls_distribution: { attempt: number; contacts: number; calls: number }[];
};

export type LeadsResponse = {
  from: string;
  to: string;
  stats: LeadsStats;
};

type CallRow = {
  id: string;
  contact_id: string | null;
  started_at: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  to_e164: string | null;
  metadata: { qualification?: string | null } | null;
};

const ACTIVE_STATES = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);
const ROW_CAP = 8000;

export async function GET(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const orgId = await requestOrgId(request);
  const { searchParams } = new URL(request.url);

  const now = new Date();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const to = toParam ? new Date(toParam) : now;
  const from = fromParam ? new Date(fromParam) : new Date(now.getTime() - 7 * 86400_000);
  const leadsSource: LeadsSource = searchParams.get("leads_source") === "test" ? "test" : "prod";
  const leadsTable = leadsTableFor(leadsSource);
  const system = parseCallSystem(searchParams.get("system"));
  const gf = parseGlobalFilters((k) => searchParams.get(k));

  const sb = supabaseServer();

  // Fetch all calls in the period
  const { rows: data, error } = await fetchAllPaged<any>(
    () => {
      let q = sb
        .from("calls")
        .select("id, contact_id, started_at, answered_at, duration_secs, to_e164, metadata")
        .eq("org_id", orgId)
        .gte("started_at", from.toISOString())
        .lte("started_at", to.toISOString())
        .order("started_at", { ascending: true });
      return q as unknown as Rangeable<any>;
    },
    { maxRows: ROW_CAP + 1000 },
  );

  if (error) return NextResponse.json({ error }, { status: 500 });

  let rows: CallRow[] = data ?? [];
  const truncated = rows.length > ROW_CAP;
  if (truncated) rows = rows.slice(0, ROW_CAP);

  // Scope to leads source (prod vs test)
  const scope = await leadsScopeFor(leadsSource);
  const inScope = (r: CallRow) =>
    callInLeadsScope(r.to_e164 ?? null, scope)
    && callMatchesSystem((r.metadata as { source?: string } | null)?.source, system);

  // Filter out phantom calls and active calls
  rows = rows.filter(
    (r) =>
      !ACTIVE_STATES.has((r.metadata as any)?.state ?? "")
      && !isPhantomCall(r as any)
      && !isSoftphoneTestLeg(r as any)
      && inScope(r),
  );

  // Load leads for global filter matching
  type LeadRow = { nom: string | null; numero_telephone: string | null; source_lead: string | null; bmi: number | null; qualification: string | null; call_count: number | null };
  let leadRows: LeadRow[] = [];
  let leadsOk = false;
  try {
    const { rows: leads, error: leadsErr } = await fetchAllPaged<LeadRow>(() =>
      sb
        .from(leadsTable as never)
        .select("nom, numero_telephone, source_lead, bmi, qualification, call_count")
        .not("numero_telephone", "is", null) as unknown as Rangeable<LeadRow>,
    );
    if (!leadsErr) {
      leadRows = leads;
      leadsOk = true;
    }
  } catch {
    /* tenant doesn't have a leads table */
  }
  const leadIdx = leadsOk ? buildLeadFilterIndex(leadRows) : EMPTY_LEAD_INDEX;

  // Apply global filters if active
  if (hasActiveGlobalFilters(gf)) {
    const attemptIdx = buildAttemptIndex(rows);
    rows = rows.filter((r) =>
      matchesGlobalFilters(gf, {
        durationSecs: r.duration_secs ?? 0,
        bucket: bucketForCall(r as any),
        agent: null,
        answered: (r.answered_at !== null && r.answered_at !== undefined),
        attempt: r.to_e164 ? attemptIdx.get(r.id) ?? null : null,
        eligibility: eligibilityForPhone(r.to_e164, leadIdx),
        source: (r.to_e164 && leadIdx.sourceByPhone.get(r.to_e164)) || null,
        haystack: `${(r.to_e164 && leadIdx.nameByPhone.get(r.to_e164)) ?? ""} ${r.to_e164 ?? ""}`.toLowerCase(),
      }),
    );
  }

  // Group calls by phone number (to_e164) to count unique people called.
  // Fallback to contact_id if no phone, then skip if neither exists.
  const byContact = new Map<string, CallRow[]>();
  for (const r of rows) {
    const key = r.to_e164 ?? r.contact_id;
    if (!key) continue;
    const contact = byContact.get(key) ?? [];
    contact.push(r);
    byContact.set(key, contact);
  }

  // Calculate stats
  const totalUniqueContacts = byContact.size;
  const totalCalls = rows.length;
  const avgCallsPerContact = totalUniqueContacts > 0 ? Math.round((totalCalls / totalUniqueContacts) * 10) / 10 : 0;

  // Count RDV and transfers
  let rdvConfirmed = 0;
  let rdvTransfer = 0;
  for (const r of rows) {
    const b = bucketForCall(r as any);
    if (b === "rdv_confirme") rdvConfirmed += 1;
    if (b === "passer_humain") rdvTransfer += 1;
  }

  // Distribution of calls per contact (attempt funnel)
  const attemptMap = new Map<number, { contacts: number; calls: number }>();
  for (const [contactId, calls] of byContact.entries()) {
    calls.sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
    calls.forEach((r, i) => {
      const attempt = Math.min(i + 1, 10); // cap at "10+"
      const agg = attemptMap.get(attempt) ?? { contacts: 0, calls: 0 };
      if (i === 0) agg.contacts += 1; // count contact once per first call
      agg.calls += 1;
      attemptMap.set(attempt, agg);
    });
  }
  const calls_distribution = Array.from(attemptMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([attempt, v]) => ({ attempt, contacts: v.contacts, calls: v.calls }));

  const stats: LeadsStats = {
    total_unique_contacts: totalUniqueContacts,
    total_calls: totalCalls,
    avg_calls_per_contact: avgCallsPerContact,
    rdv_confirmed: rdvConfirmed,
    rdv_transfer: rdvTransfer,
    calls_distribution,
  };

  const body: LeadsResponse = {
    from: from.toISOString(),
    to: to.toISOString(),
    stats,
  };
  return NextResponse.json(body);
}
