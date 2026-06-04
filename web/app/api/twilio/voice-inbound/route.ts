import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { validateTwilioSignature } from "@/lib/twilio-signature";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/twilio/voice-inbound
 *
 * Inbound voice webhook. Resolves the `phone_numbers` row by the dialed
 * `To` E.164 and dispatches based on its routing columns:
 *
 *   - flow_id set    → <Redirect> to /api/flows/{id}/twiml/start (IVR stub)
 *   - queue_id set   → log a 'ringing' inbound `calls` row + <Enqueue>
 *   - otherwise      → <Redirect> to the existing /api/twilio-voice handler
 *                      (bridges into the LiveKit SIP trunk where the AI agent
 *                      picks up). This preserves today's "everything goes to
 *                      the IA" default behaviour for numbers that haven't
 *                      been assigned a flow or a queue yet.
 *
 * Every Twilio request is signature-validated and we append a
 * `call_events` row tagged `twilio_inbound` with the raw form payload for
 * debugging / audit. Multi-tenant: phone_numbers lookup is naturally
 * scoped to one org because (org_id, e164) is unique in the table.
 */
export async function POST(req: Request) {
  const rawBody = await req.text().catch(() => "");
  const form = new URLSearchParams(rawBody);

  if (!validateTwilioSignature(req, form)) {
    return new NextResponse("invalid twilio signature", { status: 403 });
  }

  const to = (form.get("To") ?? "").trim();
  const from = (form.get("From") ?? "").trim();
  const callSid = form.get("CallSid") ?? null;

  if (!to) {
    return twiml(
      `<Say>Numéro de destination manquant.</Say><Reject/>`,
      404,
    );
  }

  if (!hasSupabase()) {
    // No DB → can't route. Reject gracefully so Twilio doesn't loop.
    return twiml(`<Reject/>`, 200);
  }

  const sb = supabaseServer();

  // Resolve the phone_numbers row by E.164 (case-insensitive — phone numbers
  // are digits only but `ilike` is cheap and tolerant of any case-folded
  // alpha entries some carriers send back).
  const { data: numberRow, error: numErr } = await sb
    .from("phone_numbers")
    .select("id, org_id, e164, active, flow_id, queue_id")
    .ilike("e164", to)
    .maybeSingle();

  if (numErr) {
    log.error(`twilio/voice-inbound number lookup failed: ${numErr.message}`);
  }

  if (!numberRow || !numberRow.active) {
    return twiml(
      `<Say>Numéro non disponible.</Say><Reject/>`,
      404,
    );
  }

  // Audit: record the inbound payload as a call_event. We attach it to
  // either an existing call row (already created by Twilio status webhook,
  // unlikely because status fires after this) or skip the link and let
  // call_events have a NULL call_id when no row exists yet.
  // call_events.call_id is NOT NULL in the schema, so we only insert when
  // we have a matching call row.
  if (callSid) {
    const { data: existing } = await sb
      .from("calls")
      .select("id")
      .eq("twilio_call_sid", callSid)
      .maybeSingle();
    if (existing?.id) {
      const payload: Record<string, string> = {};
      form.forEach((v, k) => {
        payload[k] = v;
      });
      await sb.from("call_events").insert({
        call_id: existing.id,
        kind: "twilio_inbound",
        payload: { To: to, From: from, raw: payload },
      });
    }
  }

  // ── Branch 1 — IVR flow attached ────────────────────────────────────────
  if (numberRow.flow_id) {
    const flowUrl = absoluteUrl(req, `/api/flows/${numberRow.flow_id}/twiml/start`);
    return twiml(`<Redirect method="POST">${escapeXml(flowUrl)}</Redirect>`);
  }

  // ── Branch 2 — Queue attached ───────────────────────────────────────────
  if (numberRow.queue_id) {
    // Fetch the queue name (used as the Twilio queue name).
    const { data: queueRow } = await sb
      .from("queues")
      .select("id, name, fallback_voicemail")
      .eq("id", numberRow.queue_id)
      .eq("org_id", numberRow.org_id)
      .maybeSingle();

    const queueName = queueRow?.name ?? "default";

    // Pre-create the calls row so the desk UI sees the inbound immediately.
    // Twilio's status webhook will later patch state/duration on the same
    // twilio_call_sid.
    if (callSid) {
      const { data: existing } = await sb
        .from("calls")
        .select("id")
        .eq("twilio_call_sid", callSid)
        .maybeSingle();
      if (!existing) {
        await sb.from("calls").insert({
          org_id: numberRow.org_id,
          direction: "in",
          state: "ringing",
          from_e164: from || null,
          to_e164: to,
          phone_number_id: numberRow.id,
          queue_id: numberRow.queue_id,
          twilio_call_sid: callSid,
          metadata: { source: "twilio_inbound", queue_routed: true },
        });
      }
    }

    return twiml(
      `<Say language="fr-FR">Bonjour, un agent va vous répondre.</Say>` +
        `<Enqueue>${escapeXml(queueName)}</Enqueue>`,
    );
  }

  // ── Branch 3 — Fallback: hand off to existing AI/LiveKit handler ───────
  // The legacy /api/twilio-voice route bridges the call to the LiveKit
  // SIP trunk where an IA agent picks up. Mirroring rather than copying
  // keeps a single source of truth for the SIP wiring.
  const aiUrl = absoluteUrl(req, "/api/twilio-voice");
  return twiml(`<Redirect method="POST">${escapeXml(aiUrl)}</Redirect>`);
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function twiml(inner: string, status = 200): NextResponse {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`;
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function absoluteUrl(req: Request, path: string): string {
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host") ||
    "";
  if (host) return `${proto}://${host}${path}`;
  // Fallback to the request URL's origin.
  try {
    return new URL(path, req.url).toString();
  } catch {
    return path;
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
