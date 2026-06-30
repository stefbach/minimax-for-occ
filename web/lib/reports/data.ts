/**
 * Data layer for the pilotage reports. Queries calls + leads_rdv + campaign
 * tables, returns the raw aggregates each report template can format into a
 * ReportPayload. Kept template-agnostic on purpose — the same numbers feed
 * the hebdo, mensuel and funnel campaign templates.
 */

import { supabaseServer } from "@/lib/supabase";

export interface PeriodWindow {
  fromIso: string;
  toIso: string;
}

export interface CallAggregates {
  total: number;
  answered: number;
  unanswered: number;
  voicemail: number;
  /** PAS DE REPONSE or never_answered. */
  noAnswer: number;
  /** Productive qualifs that move the funnel forward. */
  rappel: number;
  rdvConfirme: number;
  passerHumain: number;
  /** Negative outcomes. */
  pasInteresse: number;
  fauxNumero: number;
  /** Audio + transcript health (recording_url populated when answered). */
  withRecording: number;
  /** Cost in cents (best-effort, may be 0 until twilio-sync runs). */
  totalCostCents: number;
  avgDurationSecs: number;
  /** Histogram by hour-of-day (UTC). 0-23. */
  byHourUtc: number[];
}

const QUAL_BUCKETS: Record<string, keyof CallAggregates> = {
  "PAS DE REPONSE": "noAnswer",
  "REPONDEUR": "voicemail",
  "repondeur": "voicemail",
  "RAPPEL": "rappel",
  "RDV CONFIRME": "rdvConfirme",
  "RDV": "rdvConfirme",
  "A PASSER A L'HUMAIN": "passerHumain",
  "PAS INTERESSE": "pasInteresse",
  "FAUX NUMERO": "fauxNumero",
};

/** Aggregate all the calls in the period for the org. */
export async function loadCallAggregates(
  orgId: string,
  period: PeriodWindow,
): Promise<CallAggregates> {
  const sb = supabaseServer();
  const out: CallAggregates = {
    total: 0, answered: 0, unanswered: 0, voicemail: 0, noAnswer: 0,
    rappel: 0, rdvConfirme: 0, passerHumain: 0,
    pasInteresse: 0, fauxNumero: 0,
    withRecording: 0, totalCostCents: 0, avgDurationSecs: 0,
    byHourUtc: new Array(24).fill(0) as number[],
  };

  // Page through calls — we never expect more than ~5k/week but cap at 20k
  // to avoid pathological scans freezing the request.
  const CHUNK = 1000;
  let from = 0;
  let durationSum = 0;
  let durationCount = 0;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await sb
      .from("calls")
      .select("id, answered_at, started_at, duration_secs, recording_url, metadata")
      .eq("org_id", orgId)
      .gte("started_at", period.fromIso)
      .lt("started_at", period.toIso)
      .range(from, from + CHUNK - 1);
    if (error) break;
    const rows = (data ?? []) as Array<{
      id: string;
      answered_at: string | null;
      started_at: string | null;
      duration_secs: number | null;
      recording_url: string | null;
      metadata: { qualification?: string | null } | null;
    }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      out.total += 1;
      if (r.answered_at) {
        out.answered += 1;
        if (r.duration_secs && r.duration_secs > 0) {
          durationSum += r.duration_secs;
          durationCount += 1;
        }
      } else {
        out.unanswered += 1;
      }
      if (r.recording_url) out.withRecording += 1;
      const qualRaw = r.metadata?.qualification ?? "";
      const bucket = QUAL_BUCKETS[qualRaw] ?? null;
      if (bucket) (out[bucket] as number) += 1;
      if (r.started_at) {
        const hour = new Date(r.started_at).getUTCHours();
        if (hour >= 0 && hour < 24) out.byHourUtc[hour] += 1;
      }
    }
    if (rows.length < CHUNK) break;
    from += CHUNK;
  }

  if (durationCount > 0) out.avgDurationSecs = Math.round(durationSum / durationCount);
  return out;
}

export interface LeadActionRow {
  id: string;
  nom: string | null;
  numero_telephone: string | null;
  qualification: string | null;
  rappel_rdv: string | null;
  call_count: number | null;
  last_call_datetime: string | null;
}

/** Leads in RAPPEL whose rappel_rdv is due (now or earlier). */
export async function loadLeadsDueForCallback(orgId: string, limit = 25): Promise<LeadActionRow[]> {
  const sb = supabaseServer();
  const nowIso = new Date().toISOString();
  const { data } = await sb
    .from("leads_rdv")
    .select("id, nom, numero_telephone, qualification, rappel_rdv, call_count, last_call_datetime")
    .eq("qualification", "RAPPEL")
    .lte("rappel_rdv", nowIso)
    .order("rappel_rdv", { ascending: true })
    .limit(limit);
  return (data ?? []) as LeadActionRow[];
}

/** Leads with high call_count but no qualif (likely re-dialed too many times). */
export async function loadOverDialedLeads(limit = 10): Promise<LeadActionRow[]> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("leads_rdv")
    .select("id, nom, numero_telephone, qualification, rappel_rdv, call_count, last_call_datetime")
    .gte("call_count", 8)
    .in("qualification", ["PAS DE REPONSE", "REPONDEUR", "NOUVEAU DOSSIER"])
    .order("call_count", { ascending: false })
    .limit(limit);
  return (data ?? []) as LeadActionRow[];
}

export interface PatientExportRow {
  nom: string | null;
  email: string | null;
  numero_telephone: string | null;
  poids: number | null;
  taille: number | null;
  bmi: number | null;
  qualification: string | null;
  last_call_datetime: string | null;
  call_count: number | null;
  patient_dob: string | null;
  other_chronic_conditions: string | null;
  current_phase: string | null;
}

const PATIENT_EXPORT_COLS = "nom, email, numero_telephone, poids, taille, bmi, qualification, last_call_datetime, call_count, patient_dob, other_chronic_conditions, current_phase";

/** Load patients active in the period (last_call_datetime within window, or created_at). */
export async function loadPatientDataForExport(
  orgId: string,
  period: PeriodWindow,
  limit = 500,
): Promise<PatientExportRow[]> {
  const sb = supabaseServer();
  // First resolve the org's primary data table
  const { data: tables } = await sb
    .from("tenant_data_tables")
    .select("physical_table")
    .eq("org_id", orgId);
  const table = (tables ?? []).find((t: { physical_table: string | null }) =>
    /leads_rdv|nhs|patient/i.test(String(t.physical_table ?? "")),
  );
  if (!table?.physical_table) return [];

  // Query the table, filtering by last_call_datetime in period (fallback: all rows up to limit)
  const { data } = await sb
    .from(table.physical_table)
    .select(PATIENT_EXPORT_COLS)
    .gte("last_call_datetime", period.fromIso)
    .lt("last_call_datetime", period.toIso)
    .limit(limit);

  if (data && data.length > 0) return data as PatientExportRow[];

  // If no results for the filtered period, return all rows (so export is always useful)
  const { data: allData } = await sb
    .from(table.physical_table)
    .select(PATIENT_EXPORT_COLS)
    .order("last_call_datetime", { ascending: false })
    .limit(limit);
  return (allData ?? []) as PatientExportRow[];
}
