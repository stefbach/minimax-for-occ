import { supabase } from "./supabase.js";
import { createCall, TwilioError } from "./twilio.js";

export interface DialJob {
  target_id: string;
  campaign_id: string;
}

/**
 * Dial a single campaign_target.
 *
 * Flow:
 *   1. Load target + campaign + contact + phone_number.
 *   2. Mark target 'dialing', bump attempts, set last_attempt_at.
 *   3. Place the Twilio call. TwiML URL points back to the Next.js app so the
 *      voice flow logic stays in one place.
 *   4. Save the resulting Twilio SID on the target's payload.
 *
 * TODO: implement /api/twilio-voice/campaign completion webhook to flip
 *       status to answered / no_answer / busy / failed based on the
 *       AsyncAmdStatusCallback + final StatusCallback. For now the worker
 *       just kicks off the call; the front updates statuses out-of-band.
 */
export async function dialTarget(job: DialJob): Promise<void> {
  const sb = supabase();

  const { data: target, error: tErr } = await sb
    .from("campaign_targets")
    .select(
      "id,campaign_id,contact_id,status,attempts,contacts(e164,display_name)",
    )
    .eq("id", job.target_id)
    .single();
  if (tErr || !target) {
    console.error(`[dial] target ${job.target_id} not found:`, tErr?.message);
    return;
  }
  if (target.status !== "pending") {
    console.log(`[dial] target ${job.target_id} status=${target.status}, skipping`);
    return;
  }

  const { data: campaign, error: cErr } = await sb
    .from("campaigns")
    .select(
      "id,state,phone_number_id,caller_id_e164,amd_enabled,max_attempts,retry_delay_min",
    )
    .eq("id", job.campaign_id)
    .single();
  if (cErr || !campaign) {
    console.error(`[dial] campaign ${job.campaign_id} not found`);
    return;
  }
  if (campaign.state !== "running") {
    console.log(`[dial] campaign ${campaign.id} not running, skipping`);
    return;
  }

  // Resolve the caller-id (E.164) to use as From.
  let fromE164: string | null = (campaign as any).caller_id_e164 ?? null;
  if (!fromE164 && campaign.phone_number_id) {
    const { data: pn } = await sb
      .from("phone_numbers")
      .select("e164")
      .eq("id", campaign.phone_number_id)
      .single();
    fromE164 = (pn?.e164 as string) ?? null;
  }
  const toE164 = (target as any).contacts?.e164 as string | null;
  if (!fromE164 || !toE164) {
    console.error(`[dial] missing from/to (from=${fromE164}, to=${toE164})`);
    await sb
      .from("campaign_targets")
      .update({ status: "failed", last_attempt_at: new Date().toISOString() })
      .eq("id", target.id);
    return;
  }

  // Optimistic update: mark dialing + bump attempts.
  const { error: uErr } = await sb
    .from("campaign_targets")
    .update({
      status: "dialing",
      attempts: (target.attempts ?? 0) + 1,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: null,
    })
    .eq("id", target.id)
    .eq("status", "pending"); // optimistic lock
  if (uErr) {
    console.error(`[dial] failed to mark dialing:`, uErr.message);
    return;
  }

  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://example.com";
  const twimlUrl = `${appUrl.replace(/\/+$/, "")}/api/twilio-voice?campaign_id=${encodeURIComponent(
    campaign.id,
  )}&target_id=${encodeURIComponent(target.id)}`;
  // TODO: wire a completion webhook (/api/twilio-voice/campaign-status) that
  // updates campaign_targets.status from the StatusCallback payload.
  const statusCallback = `${appUrl.replace(/\/+$/, "")}/api/twilio-voice/campaign-status?target_id=${encodeURIComponent(
    target.id,
  )}`;

  try {
    const call = await createCall({
      to: toE164,
      from: fromE164,
      twimlUrl,
      statusCallback,
      amd: !!campaign.amd_enabled,
      timeout: 30,
    });
    await sb
      .from("campaign_targets")
      .update({
        payload: {
          twilio_call_sid: call.sid,
          twilio_status: call.status,
          dialed_at: new Date().toISOString(),
        },
      })
      .eq("id", target.id);
    console.log(`[dial] target=${target.id} sid=${call.sid} status=${call.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTwilio = err instanceof TwilioError;
    console.error(`[dial] Twilio error target=${target.id}:`, msg);

    // Failed before connecting — schedule a retry if we still have attempts.
    const attemptsNow = (target.attempts ?? 0) + 1;
    const next =
      attemptsNow < (campaign.max_attempts ?? 3)
        ? new Date(Date.now() + (campaign.retry_delay_min ?? 60) * 60_000).toISOString()
        : null;
    await sb
      .from("campaign_targets")
      .update({
        status: next ? "pending" : "failed",
        next_attempt_at: next,
        payload: { last_error: msg, twilio_status_code: isTwilio ? (err as TwilioError).code : null },
      })
      .eq("id", target.id);
  }
}
