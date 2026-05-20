import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase.js";
import { createCall, TwilioError } from "./twilio.js";
import { countryFromE164 } from "./_phone-utils.generated.js";
import {
  parseContact,
  toDialCampaignRow,
  toDialTargetRow,
  type DialCampaignRow,
  type DialTargetRow,
} from "./types.js";

export interface DialJob {
  target_id: string;
  campaign_id: string;
}

// ─── Per-call structured logging ─────────────────────────────────────────
type LogCtx = { call_id?: string; target_id?: string; campaign_id?: string };
function prefix(ctx: LogCtx): string {
  const parts: string[] = [];
  if (ctx.call_id) parts.push(`call_id=${ctx.call_id}`);
  if (ctx.target_id) parts.push(`target=${ctx.target_id}`);
  if (ctx.campaign_id) parts.push(`campaign=${ctx.campaign_id}`);
  return parts.length > 0 ? `[${parts.join(" ")}]` : "[dial]";
}
function dlog(level: "info" | "warn" | "error", ctx: LogCtx, msg: string): void {
  const line = `${prefix(ctx)} ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}


/**
 * Org-scoped From-number picker. Returns null if the org owns nothing usable.
 * Order: country match → org default → any active number.
 */
async function pickFromNumberForOrg(
  sb: SupabaseClient,
  orgId: string,
  toE164: string,
): Promise<string | null> {
  const iso = countryFromE164(toE164);
  if (iso) {
    const { data } = await sb
      .from("phone_numbers")
      .select("e164")
      .eq("org_id", orgId)
      .eq("active", true)
      .eq("country_code", iso)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    if (data && data.length > 0) return (data[0] as { e164: string }).e164 ?? null;
  }
  {
    const { data } = await sb
      .from("phone_numbers")
      .select("e164")
      .eq("org_id", orgId)
      .eq("active", true)
      .eq("is_default", true)
      .limit(1);
    if (data && data.length > 0) return (data[0] as { e164: string }).e164 ?? null;
  }
  {
    const { data } = await sb
      .from("phone_numbers")
      .select("e164")
      .eq("org_id", orgId)
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1);
    if (data && data.length > 0) return (data[0] as { e164: string }).e164 ?? null;
  }
  return null;
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
  const ctx: LogCtx = { target_id: job.target_id, campaign_id: job.campaign_id };

  const { data: targetRaw, error: tErr } = await sb
    .from("campaign_targets")
    .select(
      "id,campaign_id,contact_id,status,attempts,contacts(e164,display_name)",
    )
    .eq("id", job.target_id)
    .single();
  if (tErr || !targetRaw) {
    dlog("error", ctx, `target not found: ${tErr?.message ?? "unknown"}`);
    return;
  }
  const target: DialTargetRow = toDialTargetRow(
    targetRaw as Record<string, unknown>,
  );
  if (target.status !== "pending") {
    dlog("info", ctx, `target status=${target.status}, skipping`);
    return;
  }

  const { data: campaignRaw, error: cErr } = await sb
    .from("campaigns")
    .select(
      "id,org_id,state,phone_number_id,caller_id_e164,amd_enabled,max_attempts,retry_delay_min",
    )
    .eq("id", job.campaign_id)
    .single();
  if (cErr || !campaignRaw) {
    dlog("error", ctx, "campaign not found");
    return;
  }
  const campaign: DialCampaignRow = toDialCampaignRow(
    campaignRaw as Record<string, unknown>,
  );
  if (campaign.state !== "running") {
    dlog("info", ctx, `campaign state=${campaign.state}, skipping`);
    return;
  }

  const contact = parseContact(target.contacts);
  const toE164: string | null = contact?.e164 ?? null;

  // Resolve the caller-id (E.164) to use as From.
  //   1. campaign.caller_id_e164         (explicit override)
  //   2. campaign.phone_number_id        (number pinned to the campaign)
  //   3. geo-routing on the destination  (org-owned number that matches toE164's
  //      country, falling back to org default, then any active number)
  let fromE164: string | null = campaign.caller_id_e164 ?? null;
  if (!fromE164 && campaign.phone_number_id) {
    const { data: pn } = await sb
      .from("phone_numbers")
      .select("e164")
      .eq("id", campaign.phone_number_id)
      .single();
    fromE164 = (pn as { e164?: string } | null)?.e164 ?? null;
  }
  if (!fromE164 && toE164 && campaign.org_id) {
    fromE164 = await pickFromNumberForOrg(sb, campaign.org_id, toE164);
  }
  if (!fromE164 || !toE164) {
    dlog("error", ctx, `missing from/to (from=${fromE164}, to=${toE164})`);
    await sb
      .from("campaign_targets")
      .update({ status: "failed", last_attempt_at: new Date().toISOString() })
      .eq("id", target.id);
    return;
  }

  // DNC enforcement — abort before bumping attempts so we don't burn through
  // retry budget on a phone number that legally must not be dialed.
  if (toE164 && (campaign as any).org_id) {
    const { data: dnc } = await sb
      .from("dnc_lists")
      .select("id, reason")
      .eq("org_id", (campaign as any).org_id as string)
      .eq("e164", toE164)
      .maybeSingle();
    if (dnc) {
      console.warn(
        `[dial] target=${target.id} blocked by DNC list (reason=${dnc.reason ?? "—"})`,
      );
      await sb
        .from("campaign_targets")
        .update({
          status: "failed",
          last_attempt_at: new Date().toISOString(),
          next_attempt_at: null,
          payload: {
            last_error: "dnc_blocked",
            dnc_reason: dnc.reason ?? null,
          },
        })
        .eq("id", target.id);
      return;
    }
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
    dlog("error", ctx, `failed to mark dialing: ${uErr.message}`);
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
    // Annotate the call_id once we have the Twilio SID for cross-system tracing.
    const callCtx: LogCtx = { ...ctx, call_id: call.sid };
    dlog("info", callCtx, `dialed sid=${call.sid} status=${call.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTwilio = err instanceof TwilioError;
    dlog("error", ctx, `Twilio error: ${msg}`);

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
