/**
 * Send a Twilio Content-template SMS.
 *
 * Used for the pre-call SMS (campaign `precall_sms`) test + any future web-side
 * sends. Auth = Account SID + Auth Token (Basic), the same creds the outbound
 * Twilio REST dial path already uses. Content templates carry their body +
 * approved variables on Twilio's side; we just pass the ContentSid + the
 * variable map ({"1": patientName}).
 */
export interface SendSmsResult {
  ok: boolean;
  sid?: string;
  status?: string;
  error?: string;
}

export async function sendContentSms(opts: {
  to: string;
  from: string;
  contentSid: string;
  variables?: Record<string, string>;
}): Promise<SendSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return { ok: false, error: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN non configurés sur le serveur." };
  }

  const body = new URLSearchParams();
  body.set("To", opts.to);
  body.set("From", opts.from);
  body.set("ContentSid", opts.contentSid);
  if (opts.variables && Object.keys(opts.variables).length > 0) {
    body.set("ContentVariables", JSON.stringify(opts.variables));
  }

  try {
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
    );
    const j = (await r.json().catch(() => ({}))) as {
      sid?: string; status?: string; code?: number; message?: string; error_message?: string;
    };
    if (!r.ok) {
      return {
        ok: false,
        status: String(j.code ?? r.status),
        error: `Twilio ${r.status} (${j.code ?? "?"}): ${j.message ?? j.error_message ?? "erreur"}`,
      };
    }
    return { ok: true, sid: j.sid, status: j.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
