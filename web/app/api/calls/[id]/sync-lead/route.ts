import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Post-call writeback: propagate finished-call signals to the tenant's
 * data_table row (e.g. OCC's leads_rdv), the fields the existing flow
 * never touches.
 *
 * Triggered from the agent's _on_shutdown after finalize_call_state /
 * auto_qualify_call have run. Fields updated when present in the target's
 * physical_table:
 *
 *   call_count                ← +1 each completed call
 *   last_call_datetime        ← calls.ended_at
 *   last_call_id              ← calls.id (cast to text)
 *   last_qualification_update ← now() when an explicit qualification
 *                               (not auto_inferred) was set on the call
 *   qualification             ← mirrored from calls.metadata.qualification
 *                               when explicit (NOT auto_inferred — we
 *                               don't pollute leads_rdv with heuristics)
 *   date_j1 / date_j3 / date_j5
 *     ← stamped to ended_at if the call was for that phase and the
 *       column is currently NULL. Drives the cadence: leads with
 *       date_j1 set wait for J3 wait_business_days, etc.
 *   j1_attempts / j3_attempts / j5_attempts
 *     ← +1 each call for the phase the call belonged to.
 *   voicemail_detected        ← true when bucket is REPONDEUR
 *   cycle_status              ← 'RDV' on RDV CONFIRME, 'CLOS' on
 *                               PAS INTERESSE / NE PAS RAPPELER /
 *                               NON ELIGIBLE / FAUX NUMERO, 'HUMAIN'
 *                               on À PASSER À L'HUMAIN. Otherwise
 *                               left untouched.
 *
 * Idempotent: the agent can call this multiple times, the +1 counters
 * use the last_call_id as a dedup token so we only bump once per call.
 *
 * Optional `APP_SHARED_TOKEN` bearer guard (matches /api/usage/agent).
 */

const NEGATIVE_CLOSED = new Set([
  "PAS INTERESSE", "NE PAS RAPPELER", "NON ELIGIBLE", "FAUX NUMERO",
]);

type CallRow = {
  id: string;
  ended_at: string | null;
  duration_secs: number | null;
  to_e164: string | null;
  metadata: Record<string, unknown> | null;
};

type TargetRow = {
  id: string;
  contact_id: string | null;
  source: string | null;
  source_metadata: Record<string, unknown> | null;
  attempts: number | null;
  last_call_id: string | null;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  const expected = process.env.APP_SHARED_TOKEN;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth && auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const { id: callId } = await ctx.params;
  if (!callId) return NextResponse.json({ error: "missing_call_id" }, { status: 400 });

  const sb = supabaseServer();

  // 1) Load the call (must be ended so ended_at / duration are real).
  const { data: callRow, error: callErr } = await sb
    .from("calls")
    .select("id, ended_at, duration_secs, to_e164, metadata")
    .eq("id", callId)
    .maybeSingle();
  if (callErr) return NextResponse.json({ error: callErr.message }, { status: 500 });
  if (!callRow) return NextResponse.json({ error: "call_not_found" }, { status: 404 });
  const call = callRow as CallRow;

  // 2) Find the campaign_target that owns this call. The agent shutdown
  //    runs before /api/twilio/status writes last_call_id, so we also
  //    accept a "most recent target dialed to this number whose source
  //    metadata still matches" lookup as a fallback.
  const { data: tgtRows } = await sb
    .from("campaign_targets")
    .select("id, contact_id, source, source_metadata, attempts, last_call_id")
    .eq("last_call_id", callId)
    .limit(1);
  let target = ((tgtRows ?? [])[0] as TargetRow | undefined) ?? null;
  if (!target && call.to_e164) {
    // Fallback: latest data_table target dialed to this number.
    const { data: alt } = await sb
      .from("campaign_targets")
      .select("id, contact_id, source, source_metadata, attempts, last_call_id, contacts(e164)")
      .order("last_attempt_at", { ascending: false, nullsFirst: false })
      .limit(20);
    target = (((alt ?? []) as unknown as Array<TargetRow & { contacts?: { e164?: string } | { e164?: string }[] }>)
      .find((t) => {
        const c = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
        return c && c.e164 === call.to_e164 && t.source === "data_table_dynamic";
      }) ?? null) as TargetRow | null;
  }

  if (!target) {
    return NextResponse.json(
      { ok: false, reason: "no_data_table_target_for_call" },
      { status: 200 },
    );
  }

  const meta = (target.source_metadata ?? {}) as Record<string, unknown>;
  const table = typeof meta.physical_table === "string" ? meta.physical_table : null;
  const rowId = typeof meta.row_id === "string" ? meta.row_id : null;
  const phase = typeof meta.phase === "string" ? meta.phase : null;
  if (!table || !rowId) {
    return NextResponse.json(
      { ok: false, reason: "target_not_data_table_mode" },
      { status: 200 },
    );
  }

  // 3) Build the PATCH payload. Tenant schemas diverge (OCC has 1st_mail,
  //    a smaller tenant may not), so we discover available columns from
  //    the row we read back — PostgREST doesn't expose information_schema.
  const callMeta = (call.metadata ?? {}) as Record<string, unknown>;
  const callQual = typeof callMeta.qualification === "string" ? callMeta.qualification : null;
  const qualSource = typeof callMeta.qualification_source === "string"
    ? callMeta.qualification_source
    : null;
  const isExplicit = callQual && qualSource !== "auto_inferred" && !qualSource?.startsWith("auto_inferred");
  const endedAt = call.ended_at ?? new Date().toISOString();

  const patch: Record<string, unknown> = {};

  const { data: leadRows, error: leadErr } = await sb
    .from(table as never)
    .select("*")
    .eq("id", rowId)
    .maybeSingle();
  if (leadErr) {
    return NextResponse.json(
      { error: leadErr.message, table, rowId },
      { status: 500 },
    );
  }
  const lead = (leadRows ?? null) as Record<string, unknown> | null;
  if (!lead) {
    return NextResponse.json(
      { ok: false, reason: "lead_row_not_found", table, rowId },
      { status: 200 },
    );
  }
  const cols = new Set(Object.keys(lead));
  const has = (n: string) => cols.has(n);

  if (has("last_call_id") && lead.last_call_id === callId) {
    return NextResponse.json({ ok: true, skipped: "already_synced" });
  }

  if (has("call_count")) {
    patch.call_count = (Number(lead?.call_count) || 0) + 1;
  }
  if (has("last_call_datetime")) patch.last_call_datetime = endedAt;
  if (has("last_call_id")) patch.last_call_id = call.id;
  if (has("last_updated")) patch.last_updated = endedAt;

  if (isExplicit) {
    if (has("qualification")) patch.qualification = callQual;
    if (has("last_qualification_update")) patch.last_qualification_update = endedAt;
  }

  // Phase progression: stamp date_jN if currently null and the call
  // belongs to that phase. The cadence engine (dynamic-selection.ts)
  // interprets date_jN being set as "phase N done, wait for N+1".
  const phaseStamps: Record<string, [string, string]> = {
    J1: ["date_j1", "j1_attempts"],
    J3: ["date_j3", "j3_attempts"],
    J5: ["date_j5", "j5_attempts"],
  };
  if (phase && phaseStamps[phase]) {
    const [dateCol, attemptsCol] = phaseStamps[phase];
    if (has(dateCol) && (lead?.[dateCol] == null || lead?.[dateCol] === "")) {
      patch[dateCol] = endedAt.slice(0, 10); // date column → YYYY-MM-DD
    }
    if (has(attemptsCol)) {
      patch[attemptsCol] = (Number(lead?.[attemptsCol]) || 0) + 1;
    }
  }

  // Cycle status transitions.
  if (has("cycle_status") && callQual) {
    if (callQual === "RDV CONFIRME") patch.cycle_status = "RDV";
    else if (NEGATIVE_CLOSED.has(callQual)) patch.cycle_status = "CLOS";
    else if (callQual === "A PASSER A L'HUMAIN") patch.cycle_status = "HUMAIN";
    // RAPPEL / PAS DE REPONSE / REPONDEUR keep cycle_status = ACTIF.
  }

  // Voicemail detected flag.
  if (has("voicemail_detected") && callQual === "REPONDEUR") {
    patch.voicemail_detected = true;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, skipped: "no_columns_to_write" });
  }

  const { error: upErr } = await sb
    .from(table as never)
    .update(patch)
    .eq("id", rowId);
  if (upErr) {
    return NextResponse.json({ error: upErr.message, table, rowId }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    table,
    row_id: rowId,
    fields_written: Object.keys(patch),
    phase,
    qualification: callQual,
    qualification_source: qualSource,
  });
}
