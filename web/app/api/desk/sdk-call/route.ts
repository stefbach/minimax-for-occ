import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/sdk-call   { to_e164: string, contact_id?: string }
 *
 * Called by the softphone when the user clicks ☎ Appeler — registers
 * the outbound Twilio Voice SDK call in Supabase so it shows up in
 * /calls (Appels live), the desk's "Appels EN COURS", per-contact
 * history, billing usage, etc. Without this the SDK leg flies under
 * the platform's radar (Twilio still bills it, the platform just
 * doesn't see it).
 *
 * Also auto-upserts the contact: a new E.164 dialed for the first
 * time becomes a contact row with no display_name, ready to be
 * enriched later.
 *
 * Returns the call_id so the browser can PATCH it with state updates
 * as the Twilio Call lifecycle fires (ringing → accept → disconnect).
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => null)) as {
    to_e164?: string;
    contact_id?: string;
  } | null;
  const to = (body?.to_e164 ?? "").trim();
  if (!to || !/^\+\d{6,15}$/.test(to)) {
    return NextResponse.json({ error: "to_e164 must be E.164" }, { status: 400 });
  }

  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseServer();
  const { data: handle } = await admin
    .from("agent_handles")
    .select("id, org_id, display_name")
    .eq("kind", "human")
    .eq("user_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!handle) {
    return NextResponse.json(
      { error: "no human agent_handle for this user" },
      { status: 404 },
    );
  }

  // Auto-upsert the contact so a freshly dialled number becomes a
  // first-class record we can attach notes / transcript / tags to later.
  let contactId = body?.contact_id ?? null;
  if (!contactId) {
    const { data: contact } = await admin
      .from("contacts")
      .upsert(
        { org_id: handle.org_id, e164: to },
        { onConflict: "org_id,e164", ignoreDuplicates: false },
      )
      .select("id")
      .single();
    contactId = contact?.id ?? null;
  }

  // The SDK leg's "from" is the caller-ID Twilio uses, which is selected
  // by /api/twilio/voice-outbound's geo-routing at the moment the TwiML
  // is fetched. We don't know it here yet — leave it null, the Twilio
  // StatusCallback can fill it in later if wired.
  const { data: call, error } = await admin
    .from("calls")
    .insert({
      org_id: handle.org_id,
      direction: "out",
      state: "ringing",
      from_e164: null,
      to_e164: to,
      agent_handle_id: handle.id,
      contact_id: contactId,
      room_id: null, // SDK call has no LiveKit room
      metadata: { channel: "twilio_voice_sdk" },
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ call_id: call.id, contact_id: contactId }, { status: 201 });
}

/**
 * PATCH /api/desk/sdk-call   { call_id, state, disposition? }
 *
 * Updates the call row as the Twilio Call lifecycle progresses. Called by
 * the softphone on `accept` (state=in_progress) and `disconnect`/`cancel`
 * /`error` (state=ended with a disposition). Keeps the call row in sync
 * without needing a StatusCallback round-trip from Twilio.
 */
export async function PATCH(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => null)) as {
    call_id?: string;
    state?: "ringing" | "in_progress" | "wrap_up" | "ended";
    disposition?: string;
  } | null;
  if (!body?.call_id || !body.state) {
    return NextResponse.json({ error: "call_id and state required" }, { status: 400 });
  }

  // Authenticate but don't enforce ownership in detail — the call_id is
  // a UUID and only the dialler ever knows it, so guessing one is hard.
  // Defence in depth: the admin client scopes the update by call_id +
  // org_id derived from the user's handle.
  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseServer();
  const { data: handle } = await admin
    .from("agent_handles")
    .select("org_id")
    .eq("kind", "human")
    .eq("user_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (!handle) {
    return NextResponse.json({ error: "no handle" }, { status: 404 });
  }

  const patch: Record<string, unknown> = { state: body.state };
  if (body.state === "in_progress") {
    patch.answered_at = new Date().toISOString();
  }
  if (body.state === "ended") {
    patch.ended_at = new Date().toISOString();
    if (body.disposition) patch.disposition = body.disposition;
  }

  const { data, error } = await admin
    .from("calls")
    .update(patch)
    .eq("id", body.call_id)
    .eq("org_id", handle.org_id)
    .select("id, state, ended_at, disposition")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
