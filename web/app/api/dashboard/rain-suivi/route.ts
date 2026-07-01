import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAIN_HANDLE_ID = "a855a4d9-9871-46bb-a109-2abb737d95c3";

export type RainPatient = {
  id: string;
  nom: string | null;
  numero_telephone: string | null;
  qualification: string | null;
  last_qualification_update: string | null;
  last_call_datetime: string | null;
  call_count: number | null;
  note: string | null;
  missing_documents: string | null;
  document_status: string | null;
  called_today: boolean;
  call_duration_secs: number | null;
  call_disposition: string | null;
  last_call_id: string | null;
};

export type NhsPatient = {
  id: string;
  lead_id: string;
  nom: string | null;
  numero_telephone: string | null;
  dossier_status: string | null;
  dossier_completion_pct: number | null;
  last_call_datetime: string | null;
  called_today: boolean;
  call_duration_secs: number | null;
  call_disposition: string | null;
  last_call_id: string | null;
};

export type RainCallStat = {
  total_today: number;
  answered_today: number;
  duration_total_secs: number;
};

export type RainMissionStats = {
  total: number;
  called: number;
  pct: number;
};

export type RainSuiviResponse = {
  humain: RainPatient[];
  rappels: RainPatient[];
  suivis: RainPatient[];
  nhs: NhsPatient[];
  stats: RainCallStat;
  mission_stats: {
    humain: RainMissionStats;
    rappels: RainMissionStats;
    suivis: RainMissionStats;
    nhs: RainMissionStats;
    overall: RainMissionStats;
  };
  selected_date: string;
  range_from: string;
  range_to: string;
  generated_at: string;
};

function calcMission(patients: { called_today: boolean }[]): RainMissionStats {
  const total = patients.length;
  const called = patients.filter((p) => p.called_today).length;
  return { total, called, pct: total > 0 ? Math.round((called / total) * 100) : 0 };
}

export async function GET(req: Request) {
  await requestOrgId(req);

  const sb = supabaseServer();

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date"); // "YYYY-MM-DD", defaults to today
  const fromParam = searchParams.get("from"); // range mode: "YYYY-MM-DD"
  const toParam = searchParams.get("to");

  let dayStart: Date;
  let dayEnd: Date;
  if (fromParam || toParam) {
    dayStart = new Date(`${fromParam ?? toParam}T00:00:00`);
    dayEnd = new Date(`${toParam ?? fromParam}T23:59:59.999`);
  } else if (dateParam) {
    dayStart = new Date(`${dateParam}T00:00:00`);
    dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
  } else {
    dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
  }
  const rangeFrom = dayStart.toISOString().slice(0, 10);
  const rangeTo = dayEnd.toISOString().slice(0, 10);

  // Rain's calls in the selected range (a single day when from === to)
  const { data: rainCalls } = await sb
    .from("calls")
    .select("id, started_at, duration_secs, disposition, to_e164, from_e164")
    .eq("agent_handle_id", RAIN_HANDLE_ID)
    .gte("started_at", dayStart.toISOString())
    .lte("started_at", dayEnd.toISOString());

  const calls = rainCalls ?? [];

  // Phone → best call info (keep longest duration)
  const callByPhone = new Map<string, { id: string; duration_secs: number | null; disposition: string | null }>();
  for (const c of calls) {
    const phone = (c.to_e164 ?? c.from_e164 ?? "").replace(/\s/g, "");
    if (!phone) continue;
    const existing = callByPhone.get(phone);
    if (!existing || (existing.duration_secs ?? 0) < (c.duration_secs ?? 0)) {
      callByPhone.set(phone, { id: c.id, duration_secs: c.duration_secs, disposition: c.disposition });
    }
  }

  type RawLead = {
    id: string;
    nom: string | null;
    numero_telephone: string | null;
    qualification: string | null;
    last_qualification_update: string | null;
    last_call_datetime: string | null;
    call_count: number | null;
    note: string | null;
    missing_documents: string | null;
    document_status: string | null;
  };

  function enrichLeads(rows: RawLead[]): RainPatient[] {
    return rows.map((p) => {
      const phone = (p.numero_telephone ?? "").replace(/\s/g, "");
      const callInfo = phone ? callByPhone.get(phone) : undefined;
      return {
        ...p,
        called_today: Boolean(callInfo),
        call_duration_secs: callInfo?.duration_secs ?? null,
        call_disposition: callInfo?.disposition ?? null,
        last_call_id: callInfo?.id ?? null,
      };
    });
  }

  const LEAD_COLS = "id, nom, numero_telephone, qualification, last_qualification_update, last_call_datetime, call_count, note, missing_documents, document_status";

  const [humainRes, rappelsRes, suivisRes, nhsRes] = await Promise.all([
    sb.from("leads_rdv").select(LEAD_COLS)
      .eq("qualification", "A PASSER A L'HUMAIN").eq("do_not_call", false)
      .order("last_qualification_update", { ascending: false }),

    sb.from("leads_rdv").select(LEAD_COLS)
      .eq("qualification", "RAPPEL").eq("do_not_call", false)
      .order("last_qualification_update", { ascending: false }),

    sb.from("leads_rdv").select(LEAD_COLS)
      .in("qualification", ["SUIVI REQUIS", "SUIVI_REQUIS"]).eq("do_not_call", false)
      .order("last_qualification_update", { ascending: false }),

    sb.from("nhs_dossiers")
      .select("id, lead_id, nom, dossier_status, dossier_completion_pct")
      .eq("submission_ready", false)
      .order("dossier_completion_pct", { ascending: false }),
  ]);

  if (humainRes.error) return NextResponse.json({ error: humainRes.error.message }, { status: 500 });

  // Enrich NHS with phone numbers from leads_rdv
  const nhsDossiers = nhsRes.data ?? [];
  const nhsLeadIds = nhsDossiers.map((d) => d.lead_id).filter(Boolean);
  const phoneByLeadId = new Map<string, { numero_telephone: string | null; last_call_datetime: string | null }>();
  if (nhsLeadIds.length > 0) {
    const { data: nhsLeads } = await sb
      .from("leads_rdv").select("id, numero_telephone, last_call_datetime").in("id", nhsLeadIds);
    for (const l of nhsLeads ?? []) {
      phoneByLeadId.set(l.id, { numero_telephone: l.numero_telephone, last_call_datetime: l.last_call_datetime });
    }
  }

  const nhs: NhsPatient[] = nhsDossiers.map((d) => {
    const lead = phoneByLeadId.get(d.lead_id) ?? { numero_telephone: null, last_call_datetime: null };
    const phone = (lead.numero_telephone ?? "").replace(/\s/g, "");
    const callInfo = phone ? callByPhone.get(phone) : undefined;
    return {
      id: d.id,
      lead_id: d.lead_id,
      nom: d.nom,
      numero_telephone: lead.numero_telephone,
      dossier_status: d.dossier_status,
      dossier_completion_pct: d.dossier_completion_pct,
      last_call_datetime: lead.last_call_datetime,
      called_today: Boolean(callInfo),
      call_duration_secs: callInfo?.duration_secs ?? null,
      call_disposition: callInfo?.disposition ?? null,
      last_call_id: callInfo?.id ?? null,
    };
  });

  const humain = enrichLeads((humainRes.data ?? []) as RawLead[]);
  const rappels = enrichLeads((rappelsRes.data ?? []) as RawLead[]);
  const suivis = enrichLeads((suivisRes.data ?? []) as RawLead[]);

  const answeredCalls = calls.filter((c) => (c.duration_secs ?? 0) > 10);
  const stats: RainCallStat = {
    total_today: calls.length,
    answered_today: answeredCalls.length,
    duration_total_secs: calls.reduce((s, c) => s + (c.duration_secs ?? 0), 0),
  };

  const allLists = [...humain, ...rappels, ...suivis, ...nhs];
  const overall: RainMissionStats = calcMission(allLists);

  return NextResponse.json({
    humain,
    rappels,
    suivis,
    nhs,
    stats,
    mission_stats: {
      humain: calcMission(humain),
      rappels: calcMission(rappels),
      suivis: calcMission(suivis),
      nhs: calcMission(nhs),
      overall,
    },
    selected_date: rangeFrom,
    range_from: rangeFrom,
    range_to: rangeTo,
    generated_at: new Date().toISOString(),
  } satisfies RainSuiviResponse);
}
