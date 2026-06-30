/**
 * Fire a webhook notification when a call is classified as a human-handoff
 * bucket (passer_humain or suivi_requis).
 *
 * Configure HANDOFF_WEBHOOK_URL in your environment to receive calls.
 * The payload is a plain JSON object; pipe it into n8n / Make / Zapier
 * to dispatch WhatsApp, email, or any other channel.
 *
 * Fully best-effort — a fetch failure is logged but never throws.
 */

import { supabaseServer } from "./supabase";
import type { QualifyResult } from "./analysis-runner";
import type { QualBucket } from "./qualification";

export const HANDOFF_BUCKETS = new Set<QualBucket>(["passer_humain", "suivi_requis"]);

export function isHandoffBucket(bucket: QualBucket | undefined): boolean {
  return !!bucket && HANDOFF_BUCKETS.has(bucket);
}

export interface HandoffPayload {
  call_id: string;
  bucket: QualBucket;
  phone: string | null;
  contact_name: string | null;
  summary: string | null;
  reason: string | null;
  confidence: number | null;
  called_at: string | null;
  duration_secs: number | null;
}

export async function notifyHandoff(
  callId: string,
  result: QualifyResult,
): Promise<void> {
  if (!isHandoffBucket(result.bucket)) return;

  const webhookUrl = process.env.HANDOFF_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const sb = supabaseServer();
    const { data } = await sb
      .from("calls")
      .select("id, to_e164, started_at, duration_secs, summary, metadata, contacts(display_name)")
      .eq("id", callId)
      .maybeSingle();

    if (!data) return;

    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const contacts = (data as { contacts?: { display_name?: string | null } | null }).contacts;
    const contactName = contacts?.display_name ?? null;
    const aiMeta = (meta.qualification_ai ?? {}) as { reason?: string };

    const payload: HandoffPayload = {
      call_id: callId,
      bucket: result.bucket as QualBucket,
      phone: (data as { to_e164?: string | null }).to_e164 ?? null,
      contact_name: contactName,
      summary: (data as { summary?: string | null }).summary ?? null,
      reason: result.reason ?? aiMeta.reason ?? null,
      confidence: result.confidence ?? null,
      called_at: (data as { started_at?: string | null }).started_at ?? null,
      duration_secs: (data as { duration_secs?: number | null }).duration_secs ?? null,
    };

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn(`[notify-handoff] webhook failed call=${callId}: ${e instanceof Error ? e.message : e}`);
  }
}
