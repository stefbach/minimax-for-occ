import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import {
  defaultWebhookUrl,
  hasTwilio,
  purchaseNumber,
  releaseNumber,
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

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("phone_numbers")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

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
    org_id?: string;
    flow_id?: string | null;
  } | null;
  if (!body?.phone_number) {
    return NextResponse.json({ error: "phone_number requis" }, { status: 400 });
  }
  // org_id is always derived from the session; body.org_id is silently
  // ignored (super_admins can still target a tenant via ?org_id=).
  const orgId = await requestOrgId(req);

  const origin = new URL(req.url).origin;
  const webhookUrl = defaultWebhookUrl(origin);
  const appUrl = publicAppUrl(origin);

  let purchased;
  try {
    purchased = await purchaseNumber({
      phoneNumber: body.phone_number,
      webhookUrl,
    });
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

  // Auto-configure webhooks (VoiceUrl + StatusCallback) — best-effort, never
  // rollback the purchase if Twilio config fails. We log a warning instead.
  const webhookResult = await tryConfigureWebhooks(purchased.sid, appUrl);
  let webhookWarning: string | null = null;
  if (!webhookResult.ok) {
    webhookWarning = webhookResult.error;
    console.warn(
      "[numbers.POST] webhook auto-config failed for",
      purchased.sid,
      "—",
      webhookResult.error,
    );
  }

  const { code: countryCode, prefix } = countryFromE164(purchased.phoneNumber);
  const jurisdiction = defaultJurisdictionForCountry(countryCode);

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("phone_numbers")
    .insert({
      org_id: orgId,
      e164: purchased.phoneNumber,
      label: body.label ?? purchased.friendlyName ?? null,
      provider: "twilio",
      provider_sid: purchased.sid,
      flow_id: body.flow_id ?? null,
      capabilities: {
        voice: purchased.capabilities.voice,
        sms: purchased.capabilities.sms,
        mms: purchased.capabilities.mms,
        fax: purchased.capabilities.fax,
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
    // Number was bought from Twilio but the DB insert failed — try to roll back.
    try {
      await releaseNumber(purchased.sid);
    } catch {
      /* best effort */
    }
    return NextResponse.json(
      { error: `Achat ok mais insertion DB échouée: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    webhookWarning ? { ...data, webhook_warning: webhookWarning } : data,
    { status: 201 },
  );
}

export async function PATCH(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as {
    label?: string | null;
    active?: boolean;
    flow_id?: string | null;
    queue_id?: string | null;
    agent_handle_id?: string | null;
    compliance_jurisdiction?: string | null;
    dnc_check_enabled?: boolean;
    notes?: string | null;
    is_default?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: "body requis" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.label !== undefined) patch.label = body.label;
  if (body.active !== undefined) patch.active = body.active;
  if (body.flow_id !== undefined) patch.flow_id = body.flow_id;
  if (body.queue_id !== undefined) patch.queue_id = body.queue_id;
  if (body.agent_handle_id !== undefined) patch.agent_handle_id = body.agent_handle_id;
  if (body.compliance_jurisdiction !== undefined)
    patch.compliance_jurisdiction = body.compliance_jurisdiction;
  if (body.dnc_check_enabled !== undefined) patch.dnc_check_enabled = body.dnc_check_enabled;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.is_default !== undefined) patch.is_default = body.is_default;

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("phone_numbers")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const sb = supabaseServer();
  const { data: row, error: fetchErr } = await sb
    .from("phone_numbers")
    .select("id, provider_sid, provider")
    .eq("id", id)
    .single();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 404 });

  // Release on Twilio if we have a SID and creds. If creds are missing we still
  // delete the row so the UI doesn't get stuck — surface a soft warning instead.
  let warning: string | null = null;
  if (row?.provider === "twilio" && row.provider_sid) {
    if (hasTwilio()) {
      try {
        await releaseNumber(row.provider_sid);
      } catch (err) {
        if (err instanceof TwilioApiError) {
          warning = `Twilio: ${err.message}`;
        } else if (err instanceof Error) {
          warning = err.message;
        }
      }
    } else {
      warning =
        "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN manquants — la ligne est supprimée mais le numéro reste actif chez Twilio.";
    }
  }

  const { error } = await sb.from("phone_numbers").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, warning });
}
