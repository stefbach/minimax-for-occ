import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/contact-by-phone?e164=+447123456789
 *
 * Resolves an Axon contact_id from a phone number. Used by the NHS S2
 * tracking tab to bridge from legacy leads_rdv phone numbers to the
 * main Axon contacts table so PatientFullProfile can load CRM data.
 * Tries the number as-is, then with/without leading +.
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ contact: null });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  if (!orgId) return NextResponse.json({ contact: null });

  const url = new URL(req.url);
  const e164 = (url.searchParams.get("e164") ?? "").trim();
  if (!e164) return NextResponse.json({ contact: null });

  const admin = supabaseServer();
  const variants = Array.from(new Set([
    e164,
    e164.replace(/^\+/, ""),
    e164.startsWith("+") ? e164 : `+${e164}`,
  ]));
  for (const phone of variants) {
    const { data } = await admin
      .from("contacts")
      .select("id, display_name, e164")
      .eq("org_id", orgId)
      .eq("e164", phone)
      .maybeSingle();
    if (data) return NextResponse.json({ contact: data });
  }

  return NextResponse.json({ contact: null });
}
