/**
 * WhatsApp delivery via Twilio — the OCC migration off WATI.
 *
 * Uses the Twilio Messages API with WhatsApp Content templates:
 *   POST /Accounts/{sid}/Messages.json
 *     From=whatsapp:+<sender>  To=whatsapp:+<e164>
 *     ContentSid=HX...  ContentVariables={"1":"<name>"}   (approved template)
 *   or Body=<text>                                         (free-form, 24h window)
 *
 * Account credentials come from env (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN —
 * already used for voice). The WhatsApp sender defaults to the registered OCC
 * number and can be overridden with TWILIO_WHATSAPP_FROM.
 */

const TWILIO_API = "https://api.twilio.com/2010-04-01";

/** Registered OCC WhatsApp sender ("Obesity Care Clinic"). Override via env. */
const DEFAULT_WHATSAPP_FROM = "whatsapp:+447700162160";

/**
 * Approved WhatsApp Content templates (Twilio Content Template Builder),
 * keyed by the historical WATI template name so existing workflow steps —
 * which still carry `template_name` — route to the right Content SID.
 */
export const WHATSAPP_TEMPLATE_SIDS: Record<string, string> = {
  v2_post_agent3_message: "HXb24f054eaf3b374bf3bdaebefb470ec0",
  s2_application_documentation_followup__assistance: "HX1ea584f9b5f67568a1f423cae318bdc8",
  post_agent3_message: "HX080db596baf5d3547f8fb75d8dec2941",
  new_whatsapp_number_notice: "HX305c25a3d8f083a444add95041649d61",
};

/** Registered OCC SMS sender — same number as WhatsApp. Override via env. */
const DEFAULT_SMS_FROM = "+447700162160";

function whatsappFrom(): string {
  const f = (process.env.TWILIO_WHATSAPP_FROM || DEFAULT_WHATSAPP_FROM).trim();
  return f.startsWith("whatsapp:") ? f : `whatsapp:${f}`;
}

function smsFrom(): string {
  const f = (process.env.TWILIO_SMS_FROM || DEFAULT_SMS_FROM).trim();
  return f.startsWith("+") ? f : "+" + f.replace(/[^0-9]/g, "");
}

/** Normalise any phone shape to Twilio's `whatsapp:+E164` form. */
function toWhatsApp(phone: string): string {
  const cleaned = phone.trim().replace(/^whatsapp:/, "");
  const e164 = cleaned.startsWith("+") ? cleaned : "+" + cleaned.replace(/[^0-9]/g, "");
  return `whatsapp:${e164}`;
}

/** Resolve a template name OR a raw Content SID (HX...) to a Content SID. */
export function resolveContentSid(nameOrSid: string): string | null {
  if (!nameOrSid) return null;
  if (/^HX[0-9a-fA-F]+$/.test(nameOrSid)) return nameOrSid;
  return WHATSAPP_TEMPLATE_SIDS[nameOrSid] ?? null;
}

async function twilioMessage(params: Record<string, string>): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("Twilio not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)");
  }
  const r = await fetch(`${TWILIO_API}/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Twilio WhatsApp ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/**
 * Send an approved WhatsApp Content template.
 * @param variables positional content variables, e.g. { "1": "John" }.
 */
export async function sendWhatsAppTemplate(
  phone: string,
  templateNameOrSid: string,
  variables: Record<string, string>,
): Promise<void> {
  const contentSid = resolveContentSid(templateNameOrSid);
  if (!contentSid) throw new Error(`Unknown WhatsApp template: ${templateNameOrSid}`);
  await twilioMessage({
    To: toWhatsApp(phone),
    From: whatsappFrom(),
    ContentSid: contentSid,
    ContentVariables: JSON.stringify(variables ?? {}),
  });
}

/** Send a free-form WhatsApp message (only deliverable inside the 24h window). */
export async function sendWhatsAppFreeform(phone: string, body: string): Promise<void> {
  await twilioMessage({ To: toWhatsApp(phone), From: whatsappFrom(), Body: body });
}

/** Send a plain SMS via Twilio (no template / approval required). */
export async function sendSms(phone: string, body: string): Promise<void> {
  const cleaned = phone.trim().replace(/^whatsapp:/, "");
  const to = cleaned.startsWith("+") ? cleaned : "+" + cleaned.replace(/[^0-9]/g, "");
  await twilioMessage({ To: to, From: smsFrom(), Body: body });
}
