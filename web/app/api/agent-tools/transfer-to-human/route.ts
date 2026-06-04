import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { nextBusinessDayAt } from "@/lib/next-business-day";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent-tools/transfer-to-human
 *
 * Called by the LiveKit IA agent's tool when it decides a patient needs
 * a human follow-up. Authenticated via a Bearer shared secret
 * (INTERNAL_AGENT_API_TOKEN env var) — NOT the user session, because
 * the agent process runs server-side without a Supabase auth cookie.
 *
 * Request body:
 *   {
 *     org_id: uuid,                  // required — the tenant
 *     contact_id?: uuid,             // patient contact (optional)
 *     original_call_id?: uuid,       // the IA call that triggered the transfer
 *     transferred_by_agent_id?: uuid // agent_handles.id (audit)
 *     qualification: string,         // e.g. "RDV demandé"
 *     reason?: string,               // free text from the IA tool
 *     scheduled_for?: string         // ISO-8601; defaults to next business day 09:00 UTC
 *   }
 *
 * Returns { task_id }.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // ── auth ──────────────────────────────────────────────────────────────
  const expected = process.env.INTERNAL_AGENT_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "INTERNAL_AGENT_API_TOKEN not set on the server" },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m || m[1] !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── body ──────────────────────────────────────────────────────────────
  const body = (await req.json().catch(() => null)) as {
    org_id?: string;
    contact_id?: string | null;
    original_call_id?: string | null;
    transferred_by_agent_id?: string | null;
    qualification?: string;
    reason?: string;
    scheduled_for?: string;
  } | null;
  if (!body?.org_id) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }
  if (!body.qualification || !body.qualification.trim()) {
    return NextResponse.json({ error: "qualification required" }, { status: 400 });
  }

  // ── scheduled_for ─────────────────────────────────────────────────────
  let scheduledFor: Date;
  if (body.scheduled_for && body.scheduled_for.trim()) {
    const ts = Date.parse(body.scheduled_for);
    if (!Number.isFinite(ts)) {
      return NextResponse.json({ error: "invalid scheduled_for" }, { status: 400 });
    }
    scheduledFor = new Date(ts);
  } else {
    scheduledFor = nextBusinessDayAt();
  }

  // ── insert ────────────────────────────────────────────────────────────
  const admin = supabaseServer();
  const { data, error } = await admin
    .from("human_callback_tasks")
    .insert({
      org_id: body.org_id,
      contact_id: body.contact_id ?? null,
      original_call_id: body.original_call_id ?? null,
      transferred_by_agent_id: body.transferred_by_agent_id ?? null,
      qualification: body.qualification.trim(),
      transfer_reason: body.reason?.trim() ?? null,
      scheduled_for: scheduledFor.toISOString(),
      status: "pending",
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ task_id: (data as { id: string }).id });
}
