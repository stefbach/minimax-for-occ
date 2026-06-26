import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/precall-sms?from=&to=&campaign_id=
 *
 * Feeds the dashboard "SMS" tab: every pre-call message logged in
 * precall_sms_log, joined to the call that followed it (same target_id, started
 * after the message) so the operator can see — per lead — when the SMS went
 * out, whether the call was placed ~lead_minutes later, and whether the patient
 * answered.
 */
type CallRow = {
  id: string;
  state: string | null;
  started_at: string | null;
  answered_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  metadata: { target_id?: string } | null;
};

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const sb = supabaseServer();
  const org_id = await requestOrgId(req);
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const campaignId = url.searchParams.get("campaign_id");

  let q = sb
    .from("precall_sms_log")
    .select(
      "id,campaign_id,target_id,contact_id,to_e164,lead_name,channel,content_sid,twilio_sid,status,error,attempt,sent_at",
    )
    .eq("org_id", org_id)
    .order("sent_at", { ascending: false })
    .limit(3000);
  if (from) q = q.gte("sent_at", from);
  if (to) q = q.lte("sent_at", to);
  if (campaignId) q = q.eq("campaign_id", campaignId);
  const { data: logs, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (logs ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return NextResponse.json([]);

  // Pull the calls that could follow these messages (same org, started at/after
  // the earliest message) and bucket them by target_id, ascending in time.
  const sentTimes = rows
    .map((r) => r.sent_at as string | null)
    .filter(Boolean)
    .sort() as string[];
  const earliest = sentTimes[0] ?? from ?? new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: calls } = await sb
    .from("calls")
    .select("id,state,started_at,answered_at,duration_secs,disposition,metadata")
    .eq("org_id", org_id)
    .gte("started_at", earliest)
    .order("started_at", { ascending: true })
    .limit(8000);

  const byTarget = new Map<string, CallRow[]>();
  for (const c of (calls ?? []) as CallRow[]) {
    const tid = c.metadata?.target_id;
    if (!tid) continue;
    const arr = byTarget.get(tid);
    if (arr) arr.push(c);
    else byTarget.set(tid, [c]);
  }

  const out = rows.map((r) => {
    const targetId = r.target_id as string | null;
    const sentAt = r.sent_at as string | null;
    const candidates = (targetId && byTarget.get(targetId)) || [];
    const after = candidates.find(
      (c) => c.started_at && sentAt && new Date(c.started_at).getTime() >= new Date(sentAt).getTime(),
    );
    let answered: "answered" | "no_answer" | "voicemail" | "pending" = "pending";
    let call_id: string | null = null;
    let call_at: string | null = null;
    let delay_secs: number | null = null;
    let duration_secs: number | null = null;
    if (after) {
      call_id = after.id;
      call_at = after.started_at;
      duration_secs = after.duration_secs ?? null;
      delay_secs =
        sentAt && after.started_at
          ? Math.round((new Date(after.started_at).getTime() - new Date(sentAt).getTime()) / 1000)
          : null;
      if (after.answered_at) answered = "answered";
      else if (after.disposition && /repond|voicemail|machine|amd/i.test(after.disposition))
        answered = "voicemail";
      else answered = "no_answer";
    }
    return { ...r, call_id, call_at, delay_secs, duration_secs, answered };
  });

  return NextResponse.json(out);
}
