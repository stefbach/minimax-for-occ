import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { supabaseServer } from "@/lib/supabase";
import { ensureCallAnalysis, synthesizeDailyReport, RainAnalysisError } from "@/lib/rain-analysis";
import type { RainAiReview } from "../rain-call-detail/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RAIN_HANDLE_ID = "a855a4d9-9871-46bb-a109-2abb737d95c3";

export type DailyReportCall = {
  call_id: string;
  nom: string | null;
  numero_telephone: string | null;
  started_at: string | null;
  duration_secs: number | null;
  status: "analyzed" | "no_recording" | "failed" | "skipped";
  ai_review: RainAiReview | null;
  error_message: string | null;
};

export type RainDailyReportResponse = {
  date: string;
  total_calls: number;
  analyzed: number;
  ratings: { bon: number; moyen: number; insuffisant: number; unrated: number };
  calls: DailyReportCall[];
  synthesis: { overall_verdict: string; strengths: string; improvements: string } | null;
  generated_at: string;
};

// GET returns the report built purely from whatever's already cached
// (fast, no AI calls). POST additionally analyses every call missing a
// review first (slow — one AssemblyAI + one DeepSeek round-trip per call),
// then always regenerates the day's synthesis.
async function buildReport(
  dateParam: string,
  opts: { analyzeMissing: boolean },
): Promise<RainDailyReportResponse> {
  const sb = supabaseServer();

  const dayStart = new Date(`${dateParam}T00:00:00`);
  const dayEnd = new Date(`${dateParam}T23:59:59.999`);

  const { data: rainCalls, error } = await sb
    .from("calls")
    .select("id, started_at, duration_secs, to_e164, from_e164, recording_url, metadata")
    .eq("agent_handle_id", RAIN_HANDLE_ID)
    .gte("started_at", dayStart.toISOString())
    .lte("started_at", dayEnd.toISOString())
    .gt("duration_secs", 10)
    .order("started_at", { ascending: true });

  if (error) throw new Error(error.message);

  const calls = rainCalls ?? [];

  // Resolve patient names by phone from leads_rdv (best-effort, for display only).
  const phones = calls.map((c) => (c.to_e164 ?? c.from_e164 ?? "").replace(/\s/g, "")).filter(Boolean);
  const nameByPhone = new Map<string, string | null>();
  if (phones.length > 0) {
    const { data: leads } = await sb
      .from("leads_rdv")
      .select("nom, numero_telephone")
      .in("numero_telephone", phones);
    for (const l of leads ?? []) {
      if (l.numero_telephone) nameByPhone.set(l.numero_telephone.replace(/\s/g, ""), l.nom);
    }
  }

  const results: DailyReportCall[] = [];
  for (const c of calls) {
    const phone = (c.to_e164 ?? c.from_e164 ?? "").replace(/\s/g, "");
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const cached = meta.rain_ai_review as RainAiReview | undefined;

    if (cached) {
      results.push({
        call_id: c.id, nom: nameByPhone.get(phone) ?? null, numero_telephone: phone || null,
        started_at: c.started_at, duration_secs: c.duration_secs,
        status: "analyzed", ai_review: cached, error_message: null,
      });
      continue;
    }

    if (!opts.analyzeMissing) {
      results.push({
        call_id: c.id, nom: nameByPhone.get(phone) ?? null, numero_telephone: phone || null,
        started_at: c.started_at, duration_secs: c.duration_secs,
        status: "skipped", ai_review: null, error_message: null,
      });
      continue;
    }

    try {
      const review = await ensureCallAnalysis(sb, { id: c.id, recording_url: c.recording_url, metadata: c.metadata });
      results.push({
        call_id: c.id, nom: nameByPhone.get(phone) ?? null, numero_telephone: phone || null,
        started_at: c.started_at, duration_secs: c.duration_secs,
        status: "analyzed", ai_review: review, error_message: null,
      });
    } catch (e) {
      const status = e instanceof RainAnalysisError && e.code === "no_recording" ? "no_recording" : "failed";
      results.push({
        call_id: c.id, nom: nameByPhone.get(phone) ?? null, numero_telephone: phone || null,
        started_at: c.started_at, duration_secs: c.duration_secs,
        status, ai_review: null, error_message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const analyzed = results.filter((r) => r.ai_review);
  const ratings = { bon: 0, moyen: 0, insuffisant: 0, unrated: 0 };
  for (const r of analyzed) {
    const rating = r.ai_review!.rating;
    if (rating === "bon") ratings.bon++;
    else if (rating === "moyen") ratings.moyen++;
    else if (rating === "insuffisant") ratings.insuffisant++;
    else ratings.unrated++;
  }

  let synthesis: RainDailyReportResponse["synthesis"] = null;
  if (analyzed.length > 0) {
    try {
      synthesis = await synthesizeDailyReport(analyzed.map((r) => ({ nom: r.nom, review: r.ai_review! })));
    } catch {
      synthesis = null;
    }
  }

  return {
    date: dateParam,
    total_calls: results.length,
    analyzed: analyzed.length,
    ratings,
    calls: results,
    synthesis,
    generated_at: new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  await requestOrgId(req);
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });
  try {
    const report = await buildReport(date, { analyzeMissing: false });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  await requestOrgId(req);
  const body = (await req.json().catch(() => ({}))) as { date?: string };
  if (!body.date) return NextResponse.json({ error: "date required" }, { status: 400 });
  try {
    const report = await buildReport(body.date, { analyzeMissing: true });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
