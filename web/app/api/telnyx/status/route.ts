import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import {
  recordUsage,
  secondsToBillableMinutes,
  estimateCostCents,
} from "@/lib/billing";
import { validateTelnyxSignature } from "@/lib/telnyx-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telnyx StatusCallback webhook (TeXML mode).
 *
 * Telnyx POSTs application/x-www-form-urlencoded with at least:
 *   CallSid, CallStatus, Duration, From, To, Direction
 *   AnsweredBy (when AMD is enabled)
 *
 * Field names mirror Twilio's for TeXML compatibility, so the logic here
 * is structurally identical to /api/twilio/status.
 *
 * We tag the StatusCallback URL with ?campaign_id=…&target_id=… from the
 * dialer so we can drive the campaign_targets lifecycle from here.
 */
export async function POST(req: Request) {
  const rawBody = await req.text().catch(() => "");
  if (!(await validateTelnyxSignature(req, rawBody))) {
    return new NextResponse("invalid telnyx signature", { status: 403 });
  }

  const params = new URLSearchParams(rawBody);
  const url = new URL(req.url);
  const campaign_id = url.searchParams.get("campaign_id");
  const target_id = url.searchParams.get("target_id");

  const get = (k: string) => params.get(k);

  const CallSid = get("CallSid");
  const CallStatus = get("CallStatus");
  const Duration = get("CallDuration") ?? get("Duration") ?? null;
  const From = get("From");
  const To = get("To");
  const AnsweredBy = get("AnsweredBy");
  const Direction = get("Direction");

  if (!CallSid) return new NextResponse("", { status: 200 });

  const sb = supabaseServer();

  const rawPayload: Record<string, string> = {};
  params.forEach((v, k) => { rawPayload[k] = v; });

  const { data: existing } = await sb
    .from("calls")
    .select("id, org_id, started_at, answered_at, metadata")
    .eq("twilio_call_sid", CallSid)
    .maybeSingle();

  const stateFromTelnyx = mapCallState(CallStatus);
  const nowIso = new Date().toISOString();

  const baseUpdate: Record<string, unknown> = {
    state: stateFromTelnyx,
    from_e164: From ?? undefined,
    to_e164: To ?? undefined,
  };
  if (CallStatus === "in-progress" || CallStatus === "answered") {
    baseUpdate.answered_at = existing?.answered_at ?? nowIso;
  }
  if (["completed", "failed", "busy", "no-answer", "canceled"].includes(CallStatus ?? "")) {
    baseUpdate.ended_at = nowIso;
  }
  if (Duration && Number.isFinite(Number(Duration))) {
    baseUpdate.duration_secs = Number(Duration);
  }

  const metadataPatch: Record<string, unknown> = {
    ...((existing?.metadata as Record<string, unknown>) ?? {}),
    telnyx_last_status: CallStatus,
    provider: "telnyx",
  };
  if (AnsweredBy) metadataPatch.amd = AnsweredBy;
  if (Direction) metadataPatch.direction_telnyx = Direction;
  baseUpdate.metadata = metadataPatch;

  const amdDisposition = dispositionFromAmd(AnsweredBy, CallStatus);
  if (amdDisposition) baseUpdate.disposition = amdDisposition;

  let callId: string | null = existing?.id ?? null;

  if (!existing) {
    let org_id: string | null = null;
    if (campaign_id) {
      const { data: camp } = await sb
        .from("campaigns")
        .select("org_id")
        .eq("id", campaign_id)
        .maybeSingle();
      org_id = (camp?.org_id as string | undefined) ?? null;
    }
    if (!org_id) org_id = "00000000-0000-0000-0000-000000000001";

    const { data: inserted, error: insErr } = await sb
      .from("calls")
      .insert({
        org_id,
        direction: Direction === "inbound" ? "in" : "out",
        twilio_call_sid: CallSid,
        started_at: nowIso,
        ...baseUpdate,
      })
      .select("id")
      .single();
    if (insErr) {
      console.error("[telnyx/status] insert calls failed:", insErr.message);
    } else {
      callId = inserted?.id as string;
    }
  } else {
    const { error: upErr } = await sb
      .from("calls")
      .update(baseUpdate)
      .eq("id", existing.id);
    if (upErr) {
      console.error("[telnyx/status] update calls failed:", upErr.message);
    }
  }

  if (callId) {
    await sb.from("call_events").insert({
      call_id: callId,
      kind: "telnyx_status",
      payload: { CallStatus, AnsweredBy, Duration, Direction, From, To, campaign_id, target_id, raw: rawPayload },
    });
  }

  if (CallStatus === "completed" && Duration && Number.isFinite(Number(Duration))) {
    let orgIdForBilling: string | null = (existing?.org_id as string | undefined) ?? null;
    if (!orgIdForBilling && callId) {
      const { data: row } = await sb.from("calls").select("org_id").eq("id", callId).maybeSingle();
      orgIdForBilling = (row?.org_id as string | undefined) ?? null;
    }
    if (orgIdForBilling) {
      const minutes = secondsToBillableMinutes(Number(Duration));
      if (minutes > 0) {
        await recordUsage(orgIdForBilling, "call_minutes", minutes, estimateCostCents("call_minutes", minutes), {
          call_id: callId,
          telnyx_call_sid: CallSid,
          direction: Direction,
          provider: "telnyx",
        });
      }
    }
  }

  if (campaign_id && target_id) {
    await updateCampaignTarget({ campaign_id, target_id, call_id: callId, CallStatus, AnsweredBy });
  }

  return new NextResponse("", { status: 200 });
}

function mapCallState(s: string | null): string {
  switch (s) {
    case "queued":
    case "initiated": return "queued";
    case "ringing": return "ringing";
    case "in-progress":
    case "answered": return "in_progress";
    case "completed": return "ended";
    case "busy":
    case "no-answer":
    case "failed":
    case "canceled": return "failed";
    default: return "in_progress";
  }
}

function dispositionFromAmd(answeredBy: string | null, callStatus: string | null): string | null {
  if (!answeredBy) return null;
  const ab = answeredBy.toLowerCase();
  if (ab === "human") return "answered";
  if (ab.startsWith("machine_")) return "voicemail";
  if (ab === "fax") return "failed";
  if (["failed", "busy", "no-answer", "canceled"].includes(callStatus ?? "")) return "failed";
  return null;
}

async function updateCampaignTarget(opts: {
  campaign_id: string;
  target_id: string;
  call_id: string | null;
  CallStatus: string | null;
  AnsweredBy: string | null;
}) {
  const sb = supabaseServer();
  const terminal = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);
  if (!opts.CallStatus || !terminal.has(opts.CallStatus)) {
    if (opts.call_id) {
      await sb.from("campaign_targets").update({ last_call_id: opts.call_id }).eq("id", opts.target_id);
    }
    return;
  }

  const { data: target } = await sb
    .from("campaign_targets")
    .select("id, attempts, status")
    .eq("id", opts.target_id)
    .maybeSingle();
  if (!target) return;

  const { data: campaign } = await sb
    .from("campaigns")
    .select("max_attempts, retry_delay_min")
    .eq("id", opts.campaign_id)
    .maybeSingle();
  const maxAttempts = (campaign?.max_attempts as number | undefined) ?? 3;
  const retryDelayMin = (campaign?.retry_delay_min as number | undefined) ?? 60;
  const attempts = ((target.attempts as number | undefined) ?? 0) + 1;

  let nextStatus: "done" | "no_answer" | "busy" | "failed" | "pending" = "failed";
  let nextAttemptAt: string | null = null;

  if (opts.CallStatus === "completed") {
    const ab = opts.AnsweredBy?.toLowerCase() ?? "";
    if (ab === "machine_start" || ab.startsWith("machine_end_")) nextStatus = "no_answer";
    else if (ab === "fax") nextStatus = "failed";
    else nextStatus = "done";
  } else if (opts.CallStatus === "busy") {
    if (attempts < maxAttempts) {
      nextStatus = "pending";
      nextAttemptAt = new Date(Date.now() + retryDelayMin * 60_000).toISOString();
    } else {
      nextStatus = "busy";
    }
  } else if (opts.CallStatus === "no-answer") {
    if (attempts < maxAttempts) {
      nextStatus = "pending";
      nextAttemptAt = new Date(Date.now() + retryDelayMin * 60_000).toISOString();
    } else {
      nextStatus = "no_answer";
    }
  }

  const update: Record<string, unknown> = { status: nextStatus, attempts, next_attempt_at: nextAttemptAt };
  if (opts.call_id) update.last_call_id = opts.call_id;

  await sb.from("campaign_targets").update(update).eq("id", opts.target_id);
}
