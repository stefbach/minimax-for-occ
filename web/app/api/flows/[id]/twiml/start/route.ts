import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { validateTwilioSignature } from "@/lib/twilio-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/flows/[id]/twiml/start
 *
 * Minimal IVR runtime stub. Reads the flow's start step (or the first
 * step by created_at if start_step_id is null) and emits a TwiML
 * <Say>…</Say><Hangup/>. Enough to prove the inbound→flow wiring end-to-end;
 * the full step graph traversal (menu_dtmf branches, gather_speech, transfer,
 * route_queue, ai_agent, voicemail) is intentionally out of scope.
 *
 * Multi-tenant: we don't have an authenticated user here (Twilio calls
 * us), so we trust the flow id to scope to its own org via the foreign
 * key, but we still validate the X-Twilio-Signature so randos can't poke
 * the endpoint. We also don't accept any tenant-altering query params.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const rawBody = await req.text().catch(() => "");
  const form = new URLSearchParams(rawBody);

  if (!validateTwilioSignature(req, form)) {
    return new NextResponse("invalid twilio signature", { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return twiml(`<Say>Flow introuvable.</Say><Hangup/>`, 404);
  }

  if (!hasSupabase()) {
    return twiml(`<Say>Configuration manquante.</Say><Hangup/>`, 500);
  }

  const sb = supabaseServer();

  const { data: flow } = await sb
    .from("flows")
    .select("id, name, start_step_id")
    .eq("id", id)
    .maybeSingle();

  if (!flow) {
    return twiml(`<Say>Flow introuvable.</Say><Hangup/>`, 404);
  }

  // Resolve the first step. Prefer flow.start_step_id; otherwise the
  // earliest-created step on the flow.
  type StepShape = { kind: string; config: Record<string, unknown>; label: string | null };
  let firstStep: StepShape | null = null;
  if (flow.start_step_id) {
    const { data } = await sb
      .from("flow_steps")
      .select("kind, config, label")
      .eq("id", flow.start_step_id)
      .maybeSingle();
    if (data) firstStep = data as unknown as StepShape;
  }
  if (!firstStep) {
    const { data } = await sb
      .from("flow_steps")
      .select("kind, config, label")
      .eq("flow_id", id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) firstStep = data as unknown as StepShape;
  }

  // Pull a speakable text out of the step config. We accept several
  // common keys flow editors might use (text/tts/prompt/message); fall
  // back to the step label or a generic greeting.
  const cfg = (firstStep?.config ?? {}) as Record<string, unknown>;
  const sayText =
    pickString(cfg, ["text", "tts", "prompt", "message", "welcome"]) ||
    firstStep?.label ||
    `Bienvenue chez ${flow.name}.`;

  return twiml(
    `<Say language="fr-FR">${escapeXml(sayText)}</Say><Hangup/>`,
  );
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function twiml(inner: string, status = 200): NextResponse {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`;
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
