import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer } from "@/lib/supabase";
import { NoPhoneNumberError, pickFromNumber } from "@/lib/geo-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/dial   { to_e164: string }
 *
 * Originates an outbound call from the agent's softphone. The agent must be
 * already connected to their desk LiveKit room (via /api/desk/token). Twilio
 * dials the target and bridges the PSTN leg through the configured SIP trunk
 * into the agent's room.
 *
 * The From number is chosen by geo-routing (pickFromNumber): a phone_numbers
 * row owned by the agent's org whose country matches the destination, falling
 * back to the org default and finally any active number. TWILIO_FROM_NUMBER is
 * no longer consulted.
 *
 * Required env:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   APP_URL            (https origin of this Next.js deployment)
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { to_e164?: string };
  const to = (body.to_e164 ?? "").trim();
  if (!to || !/^\+\d{6,15}$/.test(to)) {
    return NextResponse.json({ error: "to_e164 must be E.164 (e.g. +33756123456)" }, { status: 400 });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!sid || !token || !appUrl) {
    return NextResponse.json(
      { error: "Twilio env vars missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, APP_URL)" },
      { status: 500 },
    );
  }

  // Authenticate the user and find their human agent_handle.
  const sb = await supabaseSession();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: handle, error: handleErr } = await sb
    .from("agent_handles")
    .select("id, org_id, display_name")
    .eq("kind", "human")
    .eq("user_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (handleErr || !handle) {
    return NextResponse.json({ error: "no human agent_handle for this user" }, { status: 404 });
  }

  // Resolve the From number via geo-routing (admin client bypasses RLS so
  // the lookup sees every number owned by the org).
  const admin = supabaseServer();
  let from: string;
  try {
    const picked = await pickFromNumber(admin, handle.org_id, to);
    from = picked.e164;
  } catch (err) {
    if (err instanceof NoPhoneNumberError) {
      return NextResponse.json(
        {
          error:
            "Aucun numéro de téléphone provisionné pour cette organisation. " +
            "Achetez un numéro dans la page Numéros avant d'appeler.",
        },
        { status: 400 },
      );
    }
    const msg = err instanceof Error ? err.message : "Erreur de routage géo";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Insert a call row first so we have an id to track.
  const { data: call, error: callErr } = await admin
    .from("calls")
    .insert({
      org_id: handle.org_id,
      direction: "out",
      state: "ringing",
      from_e164: from,
      to_e164: to,
      agent_handle_id: handle.id,
      room_id: `desk-${handle.id}`,
    })
    .select()
    .single();
  if (callErr) return NextResponse.json({ error: callErr.message }, { status: 500 });

  // Originate the Twilio call. The TwiML URL bridges the PSTN leg into the
  // agent's LiveKit room via the SIP trunk.
  const twimlUrl = `${appUrl.replace(/\/$/, "")}/api/twilio-voice?room=${encodeURIComponent(`desk-${handle.id}`)}&call_id=${call.id}`;
  const statusCb = `${appUrl.replace(/\/$/, "")}/api/twilio/status`;

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("From", from);
  params.set("Url", twimlUrl);
  params.set("StatusCallback", statusCb);
  params.append("StatusCallbackEvent", "initiated");
  params.append("StatusCallbackEvent", "ringing");
  params.append("StatusCallbackEvent", "answered");
  params.append("StatusCallbackEvent", "completed");
  params.set("StatusCallbackMethod", "POST");

  const twRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );
  if (!twRes.ok) {
    const errBody = await twRes.text();
    await admin.from("calls").update({ state: "failed", ended_at: new Date().toISOString() }).eq("id", call.id);
    return NextResponse.json({ error: `Twilio: ${errBody}` }, { status: 502 });
  }
  const twData = (await twRes.json()) as { sid?: string };

  await admin
    .from("calls")
    .update({ twilio_call_sid: twData.sid ?? null })
    .eq("id", call.id);

  return NextResponse.json({ ok: true, call_id: call.id, twilio_sid: twData.sid }, { status: 201 });
}
