import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { validateTwilioSignature } from "@/lib/twilio-signature";
import {
  absoluteOrigin,
  buildRenderCtx,
  escapeXml,
  renderStep,
  resolveDtmfNext,
  resolveSpeechNext,
  wrapResponse,
  type FlowEdge,
  type FlowStep,
} from "@/lib/flow-twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/flows/[id]/twiml/handle?from={step_id}
 *
 * Continuation endpoint for branching IVR steps (menu_dtmf, gather_speech).
 * Twilio posts back the caller's `Digits` or `SpeechResult`; we resolve
 * the next step via flow_edges conditions (or config.options for legacy
 * DTMF), then render TwiML for it.
 *
 * `from=__chain__` + `next={step_id}` is an internal escape hatch from
 * the renderer when its inline-recursion depth budget is exceeded — it
 * lets a deep chain of welcome steps continue without exploding the
 * TwiML payload.
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
  if (!id) return rejectTwiml("Flow introuvable.", 404);
  if (!hasSupabase()) return rejectTwiml("Configuration manquante.", 500);

  const url = new URL(req.url);
  const fromStepId = url.searchParams.get("from") ?? "";
  const chainNextId = url.searchParams.get("next") ?? "";

  const sb = supabaseServer();

  const { data: flow } = await sb
    .from("flows")
    .select("id, org_id, name, start_step_id, metadata")
    .eq("id", id)
    .maybeSingle();
  if (!flow) return rejectTwiml("Flow introuvable.", 404);

  const [stepsRes, edgesRes] = await Promise.all([
    sb
      .from("flow_steps")
      .select("id, flow_id, kind, label, config")
      .eq("flow_id", id)
      .order("created_at", { ascending: true }),
    sb
      .from("flow_edges")
      .select("id, flow_id, from_step_id, to_step_id, condition, position")
      .eq("flow_id", id)
      .order("position", { ascending: true }),
  ]);

  const steps = ((stepsRes.data ?? []) as unknown as FlowStep[]).map((s) => ({
    ...s,
    config: (s.config ?? {}) as Record<string, unknown>,
  }));
  const edges = ((edgesRes.data ?? []) as unknown as FlowEdge[]).map((e) => ({
    ...e,
    condition: (e.condition ?? {}) as Record<string, unknown>,
  }));

  const meta = (flow.metadata ?? {}) as Record<string, unknown>;
  const voice = typeof meta.voice === "string" ? (meta.voice as string) : "alice";
  const language =
    typeof meta.language === "string" ? (meta.language as string) : "fr-FR";

  const rctx = buildRenderCtx({
    flow_id: id,
    base_url: absoluteOrigin(req),
    voice,
    language,
    steps,
    edges,
  });

  // ── Internal chain continuation ─────────────────────────────────────
  if (fromStepId === "__chain__" && chainNextId) {
    const nextStep = rctx.stepsById.get(chainNextId);
    if (!nextStep) return rejectTwiml("Step not found.", 404);
    return twiml(renderStep(nextStep, rctx));
  }

  // ── Branching step resolution ───────────────────────────────────────
  const fromStep = rctx.stepsById.get(fromStepId);
  if (!fromStep) return rejectTwiml("Source step not found.", 404);

  const digits = (form.get("Digits") ?? "").trim();
  const speech = (form.get("SpeechResult") ?? "").trim();

  let next: FlowStep | null = null;
  if (digits) {
    next = resolveDtmfNext(fromStep, digits, rctx);
  } else if (speech) {
    next = resolveSpeechNext(fromStep, speech, rctx);
  } else {
    // No input — likely a timeout. Try the "always" successor / fall through.
    next = resolveDtmfNext(fromStep, "", rctx);
  }

  if (!next) {
    return twiml(
      `<Say voice="${escapeXml(voice)}" language="${escapeXml(language)}">Choix non reconnu. Au revoir.</Say><Hangup/>`,
    );
  }

  return twiml(renderStep(next, rctx));
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function twiml(inner: string, status = 200): NextResponse {
  return new NextResponse(wrapResponse(inner), {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function rejectTwiml(message: string, status: number): NextResponse {
  return twiml(`<Say language="fr-FR">${escapeXml(message)}</Say><Reject/>`, status);
}
