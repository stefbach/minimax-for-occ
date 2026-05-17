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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

function orgFrom(req: Request): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("org_id") ?? DEFAULT_ORG;
}

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("phone_numbers")
    .select("*")
    .eq("org_id", orgFrom(req))
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

  const origin = new URL(req.url).origin;
  const webhookUrl = defaultWebhookUrl(origin);

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

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("phone_numbers")
    .insert({
      org_id: body.org_id ?? DEFAULT_ORG,
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

  return NextResponse.json(data, { status: 201 });
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
  } | null;
  if (!body) return NextResponse.json({ error: "body requis" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.label !== undefined) patch.label = body.label;
  if (body.active !== undefined) patch.active = body.active;
  if (body.flow_id !== undefined) patch.flow_id = body.flow_id;

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
