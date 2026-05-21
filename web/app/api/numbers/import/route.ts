import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import {
  findIncomingNumberByE164,
  hasTwilio,
  TwilioApiError,
  TwilioConfigError,
} from "@/lib/twilio";
import {
  countryFromE164,
  defaultJurisdictionForCountry,
  publicAppUrl,
  tryConfigureWebhooks,
} from "@/lib/twilio-config";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const E164_RE = /^\+\d{6,15}$/;

/**
 * POST /api/numbers/import   { phone_number, label?, org_id? }
 *
 * Register a Twilio number that already exists on the connected account
 * into Axon's phone_numbers table. The standard /api/numbers POST only
 * handles brand-new purchases via the Twilio search UI; this lets ops
 * claim numbers acquired outside Axon (or before Axon existed).
 *
 * Verifies ownership by querying Twilio's IncomingPhoneNumbers list for
 * the supplied E.164 — a 404 means the number isn't on this account.
 * Webhooks (VoiceUrl + StatusCallback) are (re)configured best-effort
 * so the imported number behaves like one bought through the UI.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }
  if (!hasTwilio()) {
    return NextResponse.json(
      {
        error:
          "Twilio non configuré : définissez TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN dans les variables d'environnement Vercel.",
      },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    phone_number?: string;
    label?: string;
  } | null;
  const e164 = body?.phone_number?.trim() ?? "";
  if (!E164_RE.test(e164)) {
    return NextResponse.json(
      { error: "phone_number doit être au format E.164 (ex: +447700162160)" },
      { status: 400 },
    );
  }

  // 1) Verify Twilio actually owns this number on the connected account.
  let owned;
  try {
    owned = await findIncomingNumberByE164(e164);
  } catch (err) {
    if (err instanceof TwilioConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    if (err instanceof TwilioApiError) {
      return NextResponse.json(
        { error: `Twilio: ${err.message}`, code: err.twilioCode },
        { status: err.status >= 400 && err.status < 600 ? err.status : 500 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur Twilio inconnue" },
      { status: 500 },
    );
  }
  if (!owned) {
    return NextResponse.json(
      {
        error: `Le numéro ${e164} n'appartient pas à ce compte Twilio. Vérifiez la console Twilio (Phone Numbers → Active).`,
      },
      { status: 404 },
    );
  }

  // 2) Avoid duplicates: a single phone_numbers row per E.164.
  //    Resolve the target org from the caller's session — never silently
  //    fall back to the Legacy catch-all, which would hide newly imported
  //    numbers from the user who actually clicked "Importer".
  const sb = supabaseServer();
  const orgId = await requestOrgId(req);
  const { data: existing } = await sb
    .from("phone_numbers")
    .select("id, org_id, e164")
    .eq("e164", owned.phoneNumber)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error: `Le numéro ${owned.phoneNumber} est déjà enregistré dans Axon (org ${existing.org_id}).`,
      },
      { status: 409 },
    );
  }

  // 3) Best-effort webhook (re)config — never block the import on Twilio
  //    config failures; we surface a warning so the row still gets created.
  const origin = new URL(req.url).origin;
  const appUrl = publicAppUrl(origin);
  const webhookResult = await tryConfigureWebhooks(owned.sid, appUrl);
  let webhookWarning: string | null = null;
  if (!webhookResult.ok) {
    webhookWarning = webhookResult.error;
    console.warn(
      "[numbers.import] webhook auto-config failed for",
      owned.sid,
      "—",
      webhookResult.error,
    );
  }

  // 4) Persist the row mirroring what /api/numbers POST writes after a purchase.
  const { code: countryCode, prefix } = countryFromE164(owned.phoneNumber);
  const jurisdiction = defaultJurisdictionForCountry(countryCode);
  const { data, error } = await sb
    .from("phone_numbers")
    .insert({
      org_id: orgId,
      e164: owned.phoneNumber,
      label: body?.label ?? owned.friendlyName ?? null,
      provider: "twilio",
      provider_sid: owned.sid,
      capabilities: {
        voice: owned.capabilities.voice,
        sms: owned.capabilities.sms,
        mms: owned.capabilities.mms,
        fax: owned.capabilities.fax,
      },
      active: true,
      country_code: countryCode,
      prefix,
      compliance_jurisdiction: jurisdiction,
      webhook_configured: webhookResult.ok,
      webhook_configured_at: webhookResult.ok ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json(
      { error: `Insertion DB échouée: ${error.message}` },
      { status: 500 },
    );
  }
  return NextResponse.json(
    webhookWarning ? { ...data, webhook_warning: webhookWarning } : data,
    { status: 201 },
  );
}
