import { supabaseServer } from "@/lib/supabase";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";
import { bucketForCall, type QualBucket } from "@/lib/qualification";
import { isInbound, normalizeDirectionForDb } from "@/lib/call-direction";
import {
  callInLeadsScope, leadsScopeFor, leadNameMapFor, leadNameForPhone, campaignScopeFor, type LeadsSource,
} from "@/lib/leads-source";
import { callMatchesSystem, type CallSystem } from "@/lib/call-system";
import type { InsightsCallInput, InsightsCallIndexEntry } from "./types";

const ACTIVE = new Set(["ringing", "ivr", "in_progress", "wrap_up"]);

// bucketForCall key → the FR label the insights prompt counts from.
const QUAL_LABEL_FR: Record<QualBucket, string> = {
  rdv_confirme: "RDV CONFIRME",
  passer_humain: "À PASSER À L'HUMAIN",
  rappel: "RAPPEL",
  pas_interesse: "PAS INTERESSE",
  pas_de_reponse: "PAS DE REPONSE",
  repondeur: "REPONDEUR",
  faux_numero: "FAUX NUMERO",
  non_eligible: "NON ELIGIBLE",
  ne_pas_rappeler: "NE PAS RAPPELER",
  autre: "AUTRE",
};

type Row = {
  id: string;
  direction: string | null;
  state: string | null;
  answered_at: string | null;
  started_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  from_e164: string | null;
  to_e164: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  contacts?: { display_name: string | null } | null;
};

export interface LoadedCalls {
  inputs: InsightsCallInput[];
  index: Record<string, InsightsCallIndexEntry>;
}

export async function loadInsightsCalls(args: {
  orgId: string;
  from: Date;
  to: Date;
  direction: string | null;
  leadsSource: LeadsSource;
  system: CallSystem;
  campaignId?: string | null;
}): Promise<LoadedCalls> {
  const { orgId, from, to, direction, leadsSource, system, campaignId } = args;
  const sb = supabaseServer();
  const dbDir = normalizeDirectionForDb(direction);

  const { rows: data } = await fetchAllPaged<Row>(() => {
    let q = sb
      .from("calls")
      .select(
        "id, direction, state, answered_at, started_at, duration_secs, disposition, from_e164, to_e164, summary, metadata, contacts(display_name)",
      )
      .eq("org_id", orgId)
      .gte("started_at", from.toISOString())
      .lte("started_at", to.toISOString())
      .order("started_at", { ascending: false });
    if (dbDir) q = q.eq("direction", dbDir);
    return q as unknown as Rangeable<Row>;
  });

  const [scope, campaignScope, leadNames] = await Promise.all([
    leadsScopeFor(leadsSource),
    campaignId && campaignId !== "all" ? campaignScopeFor(campaignId) : Promise.resolve(null),
    leadNameMapFor(leadsSource),
  ]);

  const rows = (data ?? []).filter(
    (r) =>
      !ACTIVE.has(r.state ?? "")
      && callInLeadsScope(r.to_e164, scope)
      && callInLeadsScope(r.to_e164, campaignScope)
      && callMatchesSystem((r.metadata as { source?: string } | null)?.source, system),
  );

  const inputs: InsightsCallInput[] = [];
  const index: Record<string, InsightsCallIndexEntry> = {};
  for (const r of rows) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const phone = isInbound(r.direction) ? r.from_e164 : r.to_e164;
    const bucket = bucketForCall(r);
    const startedAt = r.started_at ? new Date(r.started_at) : null;
    inputs.push({
      call_id: r.id,
      summary: r.summary,
      qualification: (meta.qualification as string | null) ?? null,
      qualification_effective: QUAL_LABEL_FR[bucket],
      sentiment: (meta.sentiment as string | null) ?? null,
      duration_seconds: r.duration_secs ?? 0,
      hour_of_day: startedAt ? startedAt.getUTCHours() : 0,
      day_of_week: startedAt ? startedAt.getUTCDay() : 0,
      disconnection_reason: (meta.retell_disconnection_reason as string | null) ?? r.disposition ?? null,
      attempt_number: 0,
      answered: !!r.answered_at,
    });
    index[r.id] = {
      id: r.id,
      name: r.contacts?.display_name ?? leadNameForPhone(phone, leadNames),
      phone,
      qualification: bucket,
      direction: r.direction,
      duration_secs: r.duration_secs,
      answered: !!r.answered_at,
      started_at: r.started_at,
    };
  }
  return { inputs, index };
}
