import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import {
  DEFAULT_HOLD_MUSIC_URL,
  defaultWebhookUrl,
  hasTwilio,
  updateCall,
} from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return c;
    }
  });
}

/**
 * POST /api/calls/[id]/hold
 *
 * Body: { resume?: boolean, music_url?: string }
 *
 *   resume=false (default) → swap the call's TwiML to play hold music in a loop.
 *   resume=true            → redirect the call back to the org's main Voice URL.
 *
 * The agent's side of the audio is paused while the customer hears music.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  if (!hasTwilio()) {
    return NextResponse.json({ error: "twilio_not_configured" }, { status: 503 });
  }

  // Verify the user has access to this call.
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { resume?: boolean; music_url?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* allow empty */
  }
  const resume = body.resume === true;

  const admin = supabaseServer();
  const { data: call, error } = await admin
    .from("calls")
    .select("id, org_id, twilio_call_sid, state")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!call) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!call.twilio_call_sid) {
    return NextResponse.json({ error: "no_twilio_sid_on_call" }, { status: 409 });
  }

  // Verify membership via RLS-friendly check.
  const { data: mem } = await sb
    .from("memberships")
    .select("role")
    .eq("org_id", call.org_id)
    .maybeSingle();
  if (!mem) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    if (resume) {
      // Send the call back to the standard webhook so the AI picks it up again.
      const webhookUrl = defaultWebhookUrl(new URL(request.url).origin);
      await updateCall({ sid: call.twilio_call_sid, url: webhookUrl, method: "POST" });

      await admin.from("call_events").insert({
        call_id: id,
        kind: "hold_resumed",
        by_user_id: auth.user.id,
        payload: { redirected_to: webhookUrl },
      });
      return NextResponse.json({ ok: true, on_hold: false });
    }

    // Resolve the music URL: explicit body > org override > Twilio default.
    let musicUrl: string | null = (body.music_url ?? "").trim() || null;
    if (!musicUrl) {
      const { data: org } = await admin
        .from("organizations")
        .select("hold_music_url")
        .eq("id", call.org_id)
        .maybeSingle();
      musicUrl = (org?.hold_music_url as string | null) || null;
    }
    if (!musicUrl) musicUrl = DEFAULT_HOLD_MUSIC_URL;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Play loop="100">${escapeXml(musicUrl)}</Play></Response>`;
    await updateCall({ sid: call.twilio_call_sid, twiml });

    await admin.from("call_events").insert({
      call_id: id,
      kind: "hold_started",
      by_user_id: auth.user.id,
      payload: { music_url: musicUrl },
    });
    return NextResponse.json({ ok: true, on_hold: true, music_url: musicUrl });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
