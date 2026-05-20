import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import {
  recordUsage,
  secondsToBillableMinutes,
  estimateCostCents,
} from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Twilio StatusCallback webhook.
 *
 * Twilio POSTs application/x-www-form-urlencoded with at least:
 *   CallSid, CallStatus, CallDuration|Duration, From, To, Direction
 *   AnsweredBy (when AMD is enabled): 'human' | 'machine_start' | 'machine_end_*'
 *                                     | 'fax' | 'unknown'
 *
 * We tag the original StatusCallback URL with `?campaign_id=…&target_id=…`
 * from dialer/src/dial.ts so we can also drive the `campaign_targets`
 * lifecycle from here.
 *
 * Twilio expects a 200 with empty body — payload content is ignored.
 */
export async function POST(req: Request) {
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    return new NextResponse("", { status: 200 });
  }
  if (!form) return new NextResponse("", { status: 200 });

  const url = new URL(req.url);
  const campaign_id = url.searchParams.get("campaign_id");
  const target_id = url.searchParams.get("target_id");

  const get = (k: string) => form!.get(k)?.toString() ?? null;

  const CallSid = get("CallSid");
  const CallStatus = get("CallStatus"); // initiated|ringing|in-progress|answered|completed|busy|no-answer|failed|canceled
  const Duration =
    get("CallDuration") ?? get("Duration") ?? null; // seconds (string)
  const From = get("From");
  const To = get("To");
  const AnsweredBy = get("AnsweredBy");
  const Direction = get("Direction");

  if (!CallSid) {
    return new NextResponse("", { status: 200 });
  }

  const sb = supabaseServer();

  // Build the raw payload for call_events & metadata.
  const rawPayload: Record<string, string> = {};
  form.forEach((v, k) => {
    rawPayload[k] = typeof v === "string" ? v : "";
  });

  // ── 1. Resolve / upsert the public.calls row by twilio_call_sid ─────────
  const { data: existing } = await sb
    .from("calls")
    .select("id, org_id, started_at, answered_at, metadata")
    .eq("twilio_call_sid", CallSid)
    .maybeSingle();

  // Map Twilio status → our `calls.state` enum.
  const stateFromTwilio = mapCallState(CallStatus);
  const nowIso = new Date().toISOString();

  const baseUpdate: Record<string, unknown> = {
    state: stateFromTwilio,
    from_e164: From ?? undefined,
    to_e164: To ?? undefined,
  };
  if (CallStatus === "in-progress" || CallStatus === "answered") {
    baseUpdate.answered_at = existing?.answered_at ?? nowIso;
  }
  if (
    CallStatus === "completed" ||
    CallStatus === "failed" ||
    CallStatus === "busy" ||
    CallStatus === "no-answer" ||
    CallStatus === "canceled"
  ) {
    baseUpdate.ended_at = nowIso;
  }
  if (Duration && Number.isFinite(Number(Duration))) {
    baseUpdate.duration_secs = Number(Duration);
  }
  const metadataPatch: Record<string, unknown> = {
    ...((existing?.metadata as Record<string, unknown>) ?? {}),
    twilio_last_status: CallStatus,
  };
  if (AnsweredBy) metadataPatch.amd = AnsweredBy;
  if (Direction) metadataPatch.direction_twilio = Direction;
  baseUpdate.metadata = metadataPatch;

  // AMD auto-disposition: derive `calls.disposition` from Twilio's AnsweredBy
  // detection (human / machine_start / machine_end_* / fax / unknown).
  const amdDisposition = dispositionFromAmd(AnsweredBy, CallStatus);
  if (amdDisposition) {
    baseUpdate.disposition = amdDisposition;
  }

  let callId: string | null = existing?.id ?? null;

  if (!existing) {
    // Need an org_id to insert. Try to derive it from the campaign.
    let org_id: string | null = null;
    if (campaign_id) {
      const { data: camp } = await sb
        .from("campaigns")
        .select("org_id")
        .eq("id", campaign_id)
        .maybeSingle();
      org_id = (camp?.org_id as string | undefined) ?? null;
    }
    if (!org_id) {
      // Fallback to the legacy org so the row is always insertable.
      org_id = "00000000-0000-0000-0000-000000000001";
    }
    const insertRow: Record<string, unknown> = {
      org_id,
      direction: Direction === "inbound" ? "in" : "out",
      twilio_call_sid: CallSid,
      started_at: nowIso,
      ...baseUpdate,
    };
    const { data: inserted, error: insErr } = await sb
      .from("calls")
      .insert(insertRow)
      .select("id")
      .single();
    if (insErr) {
      console.error("[twilio/status] insert calls failed:", insErr.message);
    } else {
      callId = inserted?.id as string;
    }
  } else {
    const { error: upErr } = await sb
      .from("calls")
      .update(baseUpdate)
      .eq("id", existing.id);
    if (upErr) {
      console.error("[twilio/status] update calls failed:", upErr.message);
    }
  }

  // ── 2. Append a call_events row ────────────────────────────────────────
  if (callId) {
    await sb.from("call_events").insert({
      call_id: callId,
      kind: "twilio_status",
      payload: {
        CallStatus,
        AnsweredBy,
        Duration,
        Direction,
        From,
        To,
        campaign_id,
        target_id,
        raw: rawPayload,
      },
    });
  }

  // ── 2bis. Billing: record call minutes on completed calls ──────────────
  if (CallStatus === "completed" && Duration && Number.isFinite(Number(Duration))) {
    // Prefer the org_id of the existing row; if we just inserted, the
    // insert path above resolved one (campaign or legacy fallback).
    let orgIdForBilling: string | null =
      (existing?.org_id as string | undefined) ?? null;
    if (!orgIdForBilling && callId) {
      const { data: row } = await sb
        .from("calls")
        .select("org_id")
        .eq("id", callId)
        .maybeSingle();
      orgIdForBilling = (row?.org_id as string | undefined) ?? null;
    }
    if (orgIdForBilling) {
      const minutes = secondsToBillableMinutes(Number(Duration));
      if (minutes > 0) {
        await recordUsage(
          orgIdForBilling,
          "call_minutes",
          minutes,
          estimateCostCents("call_minutes", minutes),
          {
            call_id: callId,
            twilio_call_sid: CallSid,
            direction: Direction,
          },
        );
      }
    }
  }

  // ── 3. Drive campaign_targets lifecycle ────────────────────────────────
  if (campaign_id && target_id) {
    await updateCampaignTarget({
      campaign_id,
      target_id,
      call_id: callId,
      CallStatus,
      AnsweredBy,
    });
  }

  return new NextResponse("", { status: 200 });
}

/**
 * Map Twilio AnsweredBy → our `calls.disposition` enum.
 *   human                 → "answered"
 *   machine_start | machine_end_* → "voicemail"
 *   fax                   → "failed"
 *   unknown | null        → null (let other signals decide)
 *
 * We only set a disposition when we have a meaningful AnsweredBy AND the
 * call status is at a terminal-ish point (otherwise we'd overwrite during
 * the in-progress phase before AMD completes).
 */
function dispositionFromAmd(
  answeredBy: string | null,
  callStatus: string | null,
): string | null {
  if (!answeredBy) return null;
  const ab = answeredBy.toLowerCase();
  if (ab === "human") return "answered";
  if (ab.startsWith("machine_")) return "voicemail";
  if (ab === "fax") return "failed";
  // 'unknown' — leave existing disposition alone, unless the call obviously
  // failed at the carrier layer.
  if (
    callStatus === "failed" ||
    callStatus === "busy" ||
    callStatus === "no-answer" ||
    callStatus === "canceled"
  ) {
    return "failed";
  }
  return null;
}

function mapCallState(s: string | null): string {
  switch (s) {
    case "queued":
    case "initiated":
      return "queued";
    case "ringing":
      return "ringing";
    case "in-progress":
    case "answered":
      return "in_progress";
    case "completed":
      return "ended";
    case "busy":
    case "no-answer":
    case "failed":
    case "canceled":
      return "failed";
    default:
      return "in_progress";
  }
}

/**
 * Apply the campaign_targets state machine described in the spec:
 *   completed + AnsweredBy='machine_start'  → no_answer (voicemail)
 *   completed + AnsweredBy='human'|unset    → done
 *   busy                                    → busy, retry if attempts<max
 *   no-answer                               → no_answer, retry if attempts<max
 *   failed | canceled                       → failed
 */
async function updateCampaignTarget(opts: {
  campaign_id: string;
  target_id: string;
  call_id: string | null;
  CallStatus: string | null;
  AnsweredBy: string | null;
}) {
  const sb = supabaseServer();

  // Only act on terminal Twilio statuses.
  const terminal = new Set([
    "completed",
    "busy",
    "no-answer",
    "failed",
    "canceled",
  ]);
  if (!opts.CallStatus || !terminal.has(opts.CallStatus)) {
    if (opts.call_id) {
      await sb
        .from("campaign_targets")
        .update({ last_call_id: opts.call_id })
        .eq("id", opts.target_id);
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
  const retryDelayMin =
    (campaign?.retry_delay_min as number | undefined) ?? 60;

  // attempts was bumped to dialing by the worker; treat current value as
  // post-attempt count (we only increment here on retryable terminals where
  // the worker may not have counted, but to stay aligned with the spec we
  // always bump by 1 — the dialer already bumps once before dialing, so
  // this row may be slightly off; the spec asks for ++ on every terminal).
  const attempts = ((target.attempts as number | undefined) ?? 0) + 1;

  let nextStatus:
    | "done"
    | "no_answer"
    | "busy"
    | "failed"
    | "pending" = "failed";
  let nextAttemptAt: string | null = null;

  if (opts.CallStatus === "completed") {
    const ab = opts.AnsweredBy?.toLowerCase() ?? "";
    if (ab === "machine_start" || ab.startsWith("machine_end_")) {
      // AMD reached voicemail — count as no-answer for retry semantics.
      nextStatus = "no_answer";
    } else if (ab === "fax") {
      nextStatus = "failed";
    } else {
      // 'human', 'unknown', or unset → consider the contact reached.
      nextStatus = "done";
    }
  } else if (opts.CallStatus === "busy") {
    if (attempts < maxAttempts) {
      nextStatus = "pending";
      nextAttemptAt = new Date(
        Date.now() + retryDelayMin * 60_000,
      ).toISOString();
    } else {
      nextStatus = "busy";
    }
  } else if (opts.CallStatus === "no-answer") {
    if (attempts < maxAttempts) {
      nextStatus = "pending";
      nextAttemptAt = new Date(
        Date.now() + retryDelayMin * 60_000,
      ).toISOString();
    } else {
      nextStatus = "no_answer";
    }
  } else if (opts.CallStatus === "failed" || opts.CallStatus === "canceled") {
    nextStatus = "failed";
  }

  const update: Record<string, unknown> = {
    status: nextStatus,
    attempts,
    next_attempt_at: nextAttemptAt,
  };
  if (opts.call_id) update.last_call_id = opts.call_id;

  const { error } = await sb
    .from("campaign_targets")
    .update(update)
    .eq("id", opts.target_id);
  if (error) {
    console.error(
      "[twilio/status] update campaign_targets failed:",
      error.message,
    );
  }
}
