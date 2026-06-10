import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";
import { fetchRetellCallExtras, type TranscriptTurn } from "@/lib/retell-sync";
import { bucketForCall, QUAL_BUCKETS } from "@/lib/qualification";
import { isInbound } from "@/lib/call-direction";
import { cleanPhone } from "@/lib/phone-clean";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Extra detail for a single call, opened from a dashboard drill-down row. The
// row already carries the header (name, phone, time, duration, answered,
// qualification), so this only returns what the list doesn't have: the
// recording, the LLM summary and the transcript.
//
// Transcript sourcing:
//   - Native Axon calls  → call_transcripts (LiveKit STT turns).
//   - Retell calls       → metadata.transcript_turns (stored at sync time);
//     rows synced before transcript storage existed are backfilled lazily by
//     calling Retell get-call once, then cached back into metadata.

export type CallDetailTurn = { speaker: "agent" | "customer"; text: string; t?: number };
// Patient + follow-up + medical context, pulled from the CRM lead by phone, so
// the call-detail view is as informative as the legacy "Patient call detail".
export type PatientInfo = {
  name: string | null; phone: string | null; email: string | null; dob: string | null;
  bmi: number | null; weight: number | null; height: number | null;
  source: string | null; calls_so_far: number | null; qualification: string | null; phase: string | null;
};
export type FollowupInfo = {
  appointment_date: string | null; reminder: string | null; last_call: string | null;
  email_sent: boolean | null; first_email: string | null; second_email: string | null;
};
export type MedicalInfo = {
  allergies: string | null; medications: string | null; past_surgeries: string | null;
  other_conditions: string | null; nhs_status: string | null;
};
export type HistoryItem = { date: string | null; label: string; duration_secs: number | null };
export type CallDetailResponse = {
  recording_url: string | null;
  summary: string | null;
  transcript: CallDetailTurn[];
  transcript_source: "axon" | "retell" | null;
  patient: PatientInfo | null;
  followup: FollowupInfo | null;
  medical: MedicalInfo | null;
  history: HistoryItem[];
};

type CallRow = {
  id: string;
  org_id: string;
  recording_url: string | null;
  summary: string | null;
  direction: string | null;
  started_at: string | null;
  answered_at: string | null;
  to_e164: string | null;
  from_e164: string | null;
  metadata: Record<string, unknown> | null;
};

function turnsToDetail(turns: TranscriptTurn[]): CallDetailTurn[] {
  return turns.map((t) => ({
    speaker: t.role === "user" ? "customer" : "agent",
    text: t.content,
    ...(typeof t.start === "number" ? { t: Math.max(0, Math.round(t.start)) } : {}),
  }));
}

export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const orgId = await requestOrgId(request);
  const gate = await requireModule(orgId, "dashboard");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "dashboard" }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("calls")
    .select("id, org_id, direction, recording_url, summary, started_at, answered_at, to_e164, from_e164, metadata")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const call = data as CallRow;
  const meta = (call.metadata ?? {}) as Record<string, unknown>;

  // 1. Native Axon transcript turns (LiveKit STT). started_at per turn gives us
  // the timestamp; anchor on answered_at (talk start) else the call start.
  const { data: trData } = await sb
    .from("call_transcripts")
    .select("speaker, text, seq, started_at")
    .eq("call_id", id)
    .order("seq", { ascending: true });
  const axonTurns = (trData ?? []) as Array<{ speaker: string | null; text: string | null; started_at: string | null }>;

  let transcript: CallDetailTurn[] = [];
  let transcriptSource: "axon" | "retell" | null = null;
  let recordingUrl = call.recording_url;

  if (axonTurns.length) {
    // Anchor on the FIRST transcript turn, not answered_at: Twilio's
    // answered/in-progress timestamp can land well after the conversation
    // actually started (observed ~76s late), which would push every early turn
    // negative → all 0:00. The first turn's time is the true t=0.
    const firstTurnIso = axonTurns.find((t) => t.started_at)?.started_at ?? null;
    const anchorMs = firstTurnIso ? Date.parse(firstTurnIso)
      : call.answered_at ? Date.parse(call.answered_at)
      : call.started_at ? Date.parse(call.started_at) : NaN;
    transcript = axonTurns
      .filter((t) => t.text)
      .map((t) => {
        const turnMs = t.started_at ? Date.parse(t.started_at) : NaN;
        const rel = Number.isFinite(anchorMs) && Number.isFinite(turnMs)
          ? Math.max(0, Math.round((turnMs - anchorMs) / 1000)) : undefined;
        return {
          speaker: (t.speaker === "customer" || t.speaker === "user" ? "customer" : "agent") as "agent" | "customer",
          text: t.text as string,
          ...(rel != null ? { t: rel } : {}),
        };
      });
    transcriptSource = "axon";
  } else if (meta.source === "retell_sync") {
    transcriptSource = "retell";
    const stored = Array.isArray(meta.transcript_turns) ? (meta.transcript_turns as TranscriptTurn[]) : null;
    if (stored && stored.length) {
      transcript = turnsToDetail(stored);
    }

    // Lazy backfill from Retell — ONE get-call fills whatever's still missing
    // (recording and/or transcript, including per-turn timestamps) so older
    // rows become listenable/readable. Skip once tried, to avoid re-hammering.
    const retellId = typeof meta.retell_call_id === "string" ? meta.retell_call_id : null;
    const storedHasTime = Boolean(stored && stored.some((t) => typeof t.start === "number"));
    // Re-fetch when there's no transcript, or when we have one without per-turn
    // timestamps and haven't already learned Retell doesn't provide them.
    const needTranscript = (transcript.length === 0
      || (transcript.length > 0 && !storedHasTime && meta.transcript_no_timestamps !== true))
      && meta.transcript_unavailable !== true;
    const needRecording = !recordingUrl && meta.recording_unavailable !== true;
    if (retellId && (needTranscript || needRecording)) {
      const fetched = await fetchRetellCallExtras(retellId);
      const metaUpdate: Record<string, unknown> = { ...meta };
      let metaChanged = false;

      if (needRecording) {
        if (fetched.recording_url) {
          recordingUrl = fetched.recording_url;
        } else {
          metaUpdate.recording_unavailable = true; metaChanged = true;
        }
      }
      if (needTranscript) {
        if (fetched.turns?.length) {
          transcript = turnsToDetail(fetched.turns);
          metaUpdate.transcript_turns = fetched.turns;
          if (fetched.text) metaUpdate.transcript_text = fetched.text;
          // Remember if Retell gave no word timings, so we stop retrying.
          if (!fetched.turns.some((t) => typeof t.start === "number")) metaUpdate.transcript_no_timestamps = true;
          metaChanged = true;
        } else if (fetched.text) {
          transcript = [{ speaker: "agent", text: fetched.text }];
          metaUpdate.transcript_text = fetched.text; metaChanged = true;
        } else {
          metaUpdate.transcript_unavailable = true; metaChanged = true;
        }
      }

      // Persist the recording on its column + any metadata flags in one write.
      const colUpdate: Record<string, unknown> = {};
      if (needRecording && fetched.recording_url) colUpdate.recording_url = fetched.recording_url;
      if (metaChanged) colUpdate.metadata = metaUpdate;
      if (Object.keys(colUpdate).length) {
        await sb.from("calls").update(colUpdate).eq("id", id).eq("org_id", orgId);
      }
    }

    // Last resort: a flat transcript string with no turns.
    if (transcript.length === 0 && typeof meta.transcript_text === "string" && meta.transcript_text.trim()) {
      transcript = [{ speaker: "agent", text: meta.transcript_text }];
    }
  }

  // Trunk recordings (Path A LiveKit-SIP via Twilio) have no per-call webhook,
  // so recording_url stays NULL even though the audio exists on Twilio. Surface
  // the proxy path — /api/dashboard/call-recording lazily resolves the recording
  // (by CallSid, or by number+time for split LiveKit/Twilio legs) and 404s
  // gracefully if Twilio truly has none — so the player renders whenever a
  // recording plausibly exists.
  if (!recordingUrl && meta.source !== "retell_sync" && call.answered_at) {
    const twilioSid = typeof meta.twilio_call_sid === "string" ? meta.twilio_call_sid : "";
    const hasSid = /^CA[0-9a-f]{32}$/i.test(twilioSid);
    const canMatchByNumber = Boolean(call.started_at && (call.to_e164 || call.from_e164));
    if ((hasSid && meta.recording_unavailable !== true)
        || (!hasSid && canMatchByNumber && meta.twilio_recording_unavailable !== true)) {
      recordingUrl = `/api/dashboard/call-recording?id=${encodeURIComponent(id)}`;
    }
  }

  // ── Patient / follow-up / medical from the CRM lead (by phone) ────────────
  // Strip SIP URIs / Client identities so the lead lookup keys on a real E.164
  // and the pane never shows `sip:…` / `client:user-…` as the patient number.
  const patientPhone = cleanPhone(isInbound(call.direction ?? null) ? call.from_e164 : call.to_e164);
  let patient: PatientInfo | null = null;
  let followup: FollowupInfo | null = null;
  let medical: MedicalInfo | null = null;
  if (patientPhone) {
    const norm = patientPhone.replace(/\s+/g, "");
    type Lead = Record<string, unknown>;
    const cols = "nom, email, numero_telephone, bmi, poids, taille, source_lead, call_count, patient_dob, date_rdv, rappel_rdv, last_call_datetime, email_sent, \"1st_mail\", \"2nd_mail\", qualification, current_phase, allergies, current_medications, past_surgeries, other_chronic_conditions, nhs_wmp_status";
    let lead: Lead | null = null;
    for (const table of ["leads_rdv", "leads_rdv_test_axon"]) {
      try {
        const { data: leads } = await sb
          .from(table as never)
          .select(cols)
          .or(`numero_telephone.eq.${norm},numero_telephone.eq.${patientPhone}`)
          .limit(1);
        if (leads && leads.length) { lead = leads[0] as Lead; break; }
      } catch { /* table/column missing — skip */ }
    }
    if (lead) {
      const s = (k: string) => { const v = lead![k]; return v == null || v === "" ? null : String(v); };
      const n = (k: string) => { const v = Number(lead![k]); return Number.isFinite(v) ? v : null; };
      patient = {
        name: s("nom"), phone: s("numero_telephone") ?? patientPhone, email: s("email"), dob: s("patient_dob"),
        bmi: n("bmi"), weight: n("poids"), height: n("taille"),
        source: s("source_lead"), calls_so_far: n("call_count"),
        qualification: s("qualification"), phase: s("current_phase"),
      };
      followup = {
        appointment_date: s("date_rdv"), reminder: s("rappel_rdv"), last_call: s("last_call_datetime"),
        email_sent: typeof lead["email_sent"] === "boolean" ? (lead["email_sent"] as boolean) : null,
        first_email: s("1st_mail"), second_email: s("2nd_mail"),
      };
      const med: MedicalInfo = {
        allergies: s("allergies"), medications: s("current_medications"), past_surgeries: s("past_surgeries"),
        other_conditions: s("other_chronic_conditions"), nhs_status: s("nhs_wmp_status"),
      };
      // Only surface the medical block when at least one field is filled.
      if (Object.values(med).some((v) => v != null)) medical = med;
    }
  }

  // ── Call history: every call to this number, newest first (timeline) ──────
  const history: HistoryItem[] = [];
  if (patientPhone) {
    const { data: hist } = await sb
      .from("calls")
      .select("started_at, duration_secs, disposition, answered_at, metadata, to_e164, from_e164")
      .eq("org_id", orgId)
      .or(`to_e164.eq.${patientPhone},from_e164.eq.${patientPhone}`)
      .order("started_at", { ascending: false })
      .limit(20);
    for (const h of (hist ?? []) as Array<{ started_at: string | null; duration_secs: number | null; disposition: string | null; answered_at: string | null; metadata: Record<string, unknown> | null }>) {
      const b = bucketForCall(h);
      const label = QUAL_BUCKETS.find((x) => x.key === b)?.label ?? h.disposition ?? "—";
      history.push({ date: h.started_at, label, duration_secs: h.duration_secs });
    }
  }

  const body: CallDetailResponse = {
    recording_url: recordingUrl,
    summary: call.summary,
    transcript,
    transcript_source: transcriptSource,
    patient,
    followup,
    medical,
    history,
  };
  return NextResponse.json(body);
}
