import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/search-contacts?q=lorraine+turner&limit=6
 *
 * Searches Axon contacts by display_name (case-insensitive substring).
 * Used by the NHS tab global search to find patients who are in the
 * Supervision CRM but not in the NHS programme (email_sent/whatsapp_sent).
 */
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ contacts: [] });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  if (!orgId) return NextResponse.json({ contacts: [] });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ contacts: [] });
  const limit = Math.min(10, Math.max(1, Number(url.searchParams.get("limit") ?? "6")));

  const admin = supabaseServer();
  const { data, error } = await admin
    .from("contacts")
    .select("id, display_name, e164")
    .eq("org_id", orgId)
    .ilike("display_name", `%${q}%`)
    .limit(limit);
  if (error) return NextResponse.json({ contacts: [] });

  return NextResponse.json({ contacts: data ?? [] });
}
