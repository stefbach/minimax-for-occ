import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { hasTwilio } from "@/lib/twilio";
import { configureNumberWebhooks, publicAppUrl } from "@/lib/twilio-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/numbers/:id/configure-webhook
 *
 * (Re)configures VoiceUrl + StatusCallback on the underlying Twilio
 * IncomingPhoneNumber. Useful for legacy numbers that were purchased before
 * webhook auto-configuration shipped, or to repoint after an APP_URL change.
 *
 * Body is ignored (everything comes from server env + DB row). Returns the
 * URLs that were wired in, and flips webhook_configured = true on success.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }
  if (!hasTwilio()) {
    return NextResponse.json(
      { error: "Twilio non configuré (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN manquants)." },
      { status: 500 },
    );
  }

  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data: row, error: fetchErr } = await sb
    .from("phone_numbers")
    .select("id, provider, provider_sid, e164")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Numéro introuvable." }, { status: 404 });
  if (row.provider !== "twilio") {
    return NextResponse.json(
      { error: `Provider non supporté pour cette opération: ${row.provider}` },
      { status: 400 },
    );
  }
  if (!row.provider_sid) {
    return NextResponse.json(
      { error: "provider_sid manquant — impossible de configurer Twilio sans le SID." },
      { status: 400 },
    );
  }

  const origin = new URL(req.url).origin;
  const appUrl = publicAppUrl(origin);

  try {
    const configured = await configureNumberWebhooks(row.provider_sid, appUrl);
    const { data: updated, error: updErr } = await sb
      .from("phone_numbers")
      .update({
        webhook_configured: true,
        webhook_configured_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("org_id", orgId)
      .select()
      .single();
    if (updErr) {
      // Twilio is fine but we couldn't persist the flag. Surface but don't fail.
      return NextResponse.json({
        ok: true,
        configured,
        warning: `Twilio configuré, persistance DB échouée: ${updErr.message}`,
      });
    }
    return NextResponse.json({ ok: true, configured, row: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur Twilio inconnue";
    // Log but keep the row's webhook_configured flag untouched.
    console.warn("[numbers.configure-webhook] failed for", id, "—", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
