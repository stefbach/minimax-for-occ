import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { bucketForCall, QUAL_BUCKETS, type QualBucket } from "@/lib/qualification";
import { normalizeDirectionForDb } from "@/lib/call-direction";
import { callInLeadsScope, leadsTableFor, leadsScopeFor, type LeadsSource } from "@/lib/leads-source";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";
import { callMatchesSystem, parseCallSystem } from "@/lib/call-system";
import { isPhantomCall, isSoftphoneTestLeg } from "@/lib/call-quality";
import {
  parseGlobalFilters, hasActiveGlobalFilters, hasLeadScopedFilters, matchesGlobalFilters,
  buildLeadFilterIndex, buildAttemptIndex, eligibilityForPhone, EMPTY_LEAD_INDEX,
} from "@/lib/global-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);

export type LeadsAnalysisQual = {
  key: QualBucket;
  label: string;
  count: number;
  pct: number;
};

export type LeadsAnalysisResponse = {
  period: { from: string; to: string };
  // Headline counts — answered calls only
  totalAnswered: number;
  uniqueIndividuals: number;
  // The 3 most actionable buckets as named cards
  passerHumain: { count: number; pct: number };
  pasInteresse: { count: number; pct: number };
  rappel: { count: number; pct: number };
  rdvConfirme: { count: number; pct: number };
  // Full per-qualification breakdown (answered calls only, ordered by count)
  qualBreakdown: LeadsAnalysisQual[];
};

type CallRow = {
  id: string;
  direction: string | null;
  state: string | null;
  answered_at: string | null;
  started_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  agent_handle_id: string | null;
  contact_id: string | null;
  to_e164: string | null;
  summary: string | null;
  metadata: { qualification?: string | null; agent_stage?: number | null; analysis_skipped?: string | null } | null;
  contacts?: { display_name: string | null } | null;
};

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;
  const from = searchParams.get("from")
    ? new Date(searchParams.get("from")!)
    : new Date(now.getTime() - 7 * 86400_000);
  const direction = searchParams.get("direction");
  const leadsSource: LeadsSource = searchParams.get("leads_source") === "test" ? "test" : "prod";
  const leadsTable = leadsTableFor(leadsSource);
  const system = parseCallSystem(searchParams.get("system"));
  const gf = parseGlobalFilters((k) => searchParams.get(k));

  const sb = supabaseServer();
  const dbDirection = normalizeDirectionForDb(direction);

  const { rows: data, error } = await fetchAllPaged<CallRow>(() => {
    let q = sb
      .from("calls")
      .select(
        "id, direction, state, answered_at, started_at, duration_secs, disposition, agent_handle_id, contact_id, to_e164, summary, metadata, contacts(display_name)",
      )
      .eq("org_id", orgId)
      .gte("started_at", from.toISOString())
      .lte("started_at", to.toISOString())
      .order("started_at", { ascending: false });
    if (dbDirection) q = q.eq("direction", dbDirection);
    return q as unknown as Rangeable<CallRow>;
  });
  if (error) return NextResponse.json({ error }, { status: 500 });

  const scope = await leadsScopeFor(leadsSource);

  let rows = ((data ?? []) as unknown as CallRow[]).filter(
    (r) =>
      !ACTIVE.has(r.state ?? "")
      && !isPhantomCall(r)
      && callInLeadsScope(r.to_e164 ?? null, scope)
      && callMatchesSystem((r.metadata as { source?: string } | null)?.source, system)
      && !isSoftphoneTestLeg(r),
  );

  if (hasActiveGlobalFilters(gf)) {
    let leadIdx = EMPTY_LEAD_INDEX;
    if (hasLeadScopedFilters(gf) || gf.q) {
      try {
        type GfLead = { nom: string | null; numero_telephone: string | null; source_lead: string | null; bmi: number | null };
        const { rows: gfLeads, error: gfErr } = await fetchAllPaged<GfLead>(() =>
          sb
            .from(leadsTable as never)
            .select("nom, numero_telephone, source_lead, bmi")
            .not("numero_telephone", "is", null) as unknown as Rangeable<GfLead>,
        );
        if (!gfErr) leadIdx = buildLeadFilterIndex(gfLeads);
      } catch { /* no leads table */ }
    }
    const attemptIdx = buildAttemptIndex(rows);
    rows = rows.filter((r) =>
      matchesGlobalFilters(gf, {
        durationSecs: r.duration_secs ?? 0,
        bucket: bucketForCall(r),
        agent: null,
        answered: !!r.answered_at,
        attempt: r.to_e164 ? attemptIdx.get(r.id) ?? null : null,
        eligibility: eligibilityForPhone(r.to_e164, leadIdx),
        source: (r.to_e164 && leadIdx.sourceByPhone.get(r.to_e164)) || null,
        haystack: [
          r.contacts?.display_name ?? "",
          r.to_e164 ?? "",
          r.summary ?? "",
        ].join(" ").toLowerCase(),
      }),
    );
  }

  // Bucket every call, then keep only humanAnswered ones for this tab
  type Bucketed = { row: CallRow; bucket: QualBucket };
  const allBucketed: Bucketed[] = rows.map((r) => ({ row: r, bucket: bucketForCall(r) }));
  const answeredBucketed = allBucketed.filter(
    (b) => !!b.row.answered_at && b.bucket !== "pas_de_reponse" && b.bucket !== "repondeur",
  );

  const totalAnswered = answeredBucketed.length;

  // Unique individuals = distinct to_e164 among answered calls
  const uniquePhones = new Set(
    answeredBucketed.map((b) => b.row.to_e164).filter(Boolean),
  );
  const uniqueIndividuals = uniquePhones.size;

  // Per-bucket counts for answered calls
  const qcount: Record<QualBucket, number> = {
    rdv_confirme: 0, passer_humain: 0, rappel: 0, pas_interesse: 0,
    pas_de_reponse: 0, repondeur: 0, faux_numero: 0, non_eligible: 0,
    ne_pas_rappeler: 0, autre: 0,
  };
  for (const b of answeredBucketed) qcount[b.bucket] += 1;

  const pct = (n: number) => (totalAnswered > 0 ? Math.round((n / totalAnswered) * 100) : 0);

  const qualBreakdown: LeadsAnalysisQual[] = QUAL_BUCKETS
    .map((b) => ({
      key: b.key,
      label: b.label,
      count: qcount[b.key],
      pct: pct(qcount[b.key]),
    }))
    .filter((q) => q.count > 0)
    .sort((a, b) => b.count - a.count);

  const body: LeadsAnalysisResponse = {
    period: { from: from.toISOString(), to: to.toISOString() },
    totalAnswered,
    uniqueIndividuals,
    passerHumain: { count: qcount.passer_humain, pct: pct(qcount.passer_humain) },
    pasInteresse: { count: qcount.pas_interesse, pct: pct(qcount.pas_interesse) },
    rappel: { count: qcount.rappel, pct: pct(qcount.rappel) },
    rdvConfirme: { count: qcount.rdv_confirme, pct: pct(qcount.rdv_confirme) },
    qualBreakdown,
  };

  return NextResponse.json(body);
}
