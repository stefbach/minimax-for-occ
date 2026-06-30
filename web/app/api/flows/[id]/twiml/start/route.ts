import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { validateTwilioSignature } from "@/lib/twilio-signature";
import {
  absoluteOrigin,
  buildRenderCtx,
  escapeXml,
  renderStep,
  wrapResponse,
  type FlowEdge,
  type FlowStep,
} from "@/lib/flow-twiml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/flows/[id]/twiml/start
 *
 * Real IVR runtime entrypoint. Loads the whole flow graph (steps + edges)
 * for the given flow id, picks the start step (`flow.start_step_id` or
 * earliest by created_at as a fallback) and renders TwiML via the
 * shared renderer in `@/lib/flow-twiml`.
 *
 * Multi-tenant: Twilio calls us unauthenticated. We trust that the flow
 * id, once routed via phone_numbers in /api/twilio/voice-inbound, scopes
 * to that org. We still validate the X-Twilio-Signature so the endpoint
 * isn't openly callable, and the load only touches rows for this flow.
 *
 * Schema notes:
 *   flows(id, org_id, name, start_step_id, metadata, …)
 *   flow_steps(id, flow_id, kind, label, config jsonb, position jsonb, …)
 *   flow_edges(id, flow_id, from_step_id, to_step_id, condition jsonb, position, …)
 *   queues — no `metadata` column today, so language defaults to fr.
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

  const sb = supabaseServer();

  // Load the flow row (we only need the start_step_id + metadata for voice).
  const { data: flow } = await sb
    .from("flows")
    .select("id, org_id, name, start_step_id, metadata")
    .eq("id", id)
    .maybeSingle();

  if (!flow) return rejectTwiml("Flow introuvable.", 404);

  // Load steps + edges for this flow in parallel. Both are scoped by
  // flow_id, which is itself scoped to a single org via FK.
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

  if (steps.length === 0) {
    return twiml(
      `<Say>This flow has no steps configured.</Say><Hangup/>`,
    );
  }

  // Pick the start step.
  let start: FlowStep | undefined;
  if (flow.start_step_id) start = steps.find((s) => s.id === flow.start_step_id);
  if (!start) start = steps[0];

  if (!start) return rejectTwiml("Start step not found.", 404);

  // Voice + language from flow.metadata if present.
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

  return twiml(renderStep(start, rctx));
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
