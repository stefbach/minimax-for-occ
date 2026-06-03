import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import {
  hasTwilio,
  releaseNumber,
  TwilioApiError,
} from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/numbers/:id/release
 *
 * Convenience endpoint used from the "Santé numéros" page to release a dormant
 * number. Behaves identically to `DELETE /api/numbers?id=...` but lives at a
 * REST-y path so admin UIs can wire dedicated buttons without ambiguity.
 *
 * Steps:
 *   1. Look up the phone_numbers row.
 *   2. If provider=twilio and we have a SID + creds, release the number on
 *      Twilio. Failures are surfaced as a non-blocking warning so the DB row
 *      can still be cleaned up.
 *   3. Delete the phone_numbers row.
 *
 * Response shape mirrors the DELETE handler:
 *   { ok: true, warning: string | null }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

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

  let warning: string | null = null;
  if (row.provider === "twilio" && row.provider_sid) {
    if (hasTwilio()) {
      try {
        await releaseNumber(row.provider_sid);
      } catch (err) {
        if (err instanceof TwilioApiError) {
          warning = `Twilio: ${err.message}`;
        } else if (err instanceof Error) {
          warning = err.message;
        } else {
          warning = "Erreur Twilio inconnue";
        }
      }
    } else {
      warning =
        "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN manquants — la ligne est supprimée mais le numéro reste actif chez Twilio.";
    }
  }

  const { error } = await sb
    .from("phone_numbers")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, e164: row.e164, warning });
}
