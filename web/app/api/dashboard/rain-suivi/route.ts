import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { supabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rain's handle in agent_handles (kind='human', display_name='bheshouma-arjoon')
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
  called_today: boolean;
  call_duration_secs: number | null;
  call_disposition: string | null;
};

export type RainCallStat = {
  total_today: number;
  answered_today: number;
  duration_total_secs: number;
};

export type RainSuiviResponse = {
  patients: RainPatient[];
  stats: RainCallStat;
  generated_at: string;
};

export async function GET(req: Request) {
  await requestOrgId(req);

  const sb = supabaseServer();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  // 1. Patients qualified "A PASSER A L'HUMAIN" — Rain's daily list
  const { data: patients, error: pErr } = await sb
    .from("leads_rdv")
    .select("id, nom, numero_telephone, qualification, last_qualification_update, last_call_datetime, call_count, note")
    .eq("qualification", "A PASSER A L'HUMAIN")
    .eq("do_not_call", false)
    .order("last_qualification_update", { ascending: false });

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }

  // 2. Rain's calls today from the calls table
  const { data: rainCalls } = await sb
    .from("calls")
    .select("id, started_at, duration_secs, disposition, state, to_e164, from_e164")
    .eq("agent_handle_id", RAIN_HANDLE_ID)
    .gte("started_at", todayStart.toISOString())
    .lte("started_at", todayEnd.toISOString());

  const calls = rainCalls ?? [];

  // Build a lookup of phones Rain called today
  const callByPhone = new Map<string, { duration_secs: number | null; disposition: string | null }>();
  for (const c of calls) {
    const phone = (c.to_e164 ?? c.from_e164 ?? "").replace(/\s/g, "");
    if (phone && !callByPhone.has(phone)) {
      callByPhone.set(phone, { duration_secs: c.duration_secs, disposition: c.disposition });
    }
  }

  // 3. Enrich patients with call info
  type RawPatient = {
    id: string;
    nom: string | null;
    numero_telephone: string | null;
    qualification: string | null;
    last_qualification_update: string | null;
    last_call_datetime: string | null;
    call_count: number | null;
    note: string | null;
  };

  const enriched: RainPatient[] = (patients as RawPatient[]).map((p) => {
    const phone = (p.numero_telephone ?? "").replace(/\s/g, "");
    const callInfo = callByPhone.get(phone);
    return {
      ...p,
      called_today: Boolean(callInfo),
      call_duration_secs: callInfo?.duration_secs ?? null,
      call_disposition: callInfo?.disposition ?? null,
    };
  });

  // 4. Overall stats for Rain today
  const answeredCalls = calls.filter((c) => (c.duration_secs ?? 0) > 10);
  const stats: RainCallStat = {
    total_today: calls.length,
    answered_today: answeredCalls.length,
    duration_total_secs: calls.reduce((s, c) => s + (c.duration_secs ?? 0), 0),
  };

  return NextResponse.json({
    patients: enriched,
    stats,
    generated_at: new Date().toISOString(),
  } satisfies RainSuiviResponse);
}
