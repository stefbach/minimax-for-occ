import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/ai-callbacks
 *
 * The AI agent's calendar: leads the IA (Charlotte) is due to call back at a
 * patient-requested time. A lead qualifies when `qualification = 'RAPPEL'` and
 * `rappel_rdv` is set — exactly what the dialer's callback engine dials
 * (campaigns.metadata.engine.callback: status_value 'RAPPEL', datetime_column
 * 'rappel_rdv'). So this view is a faithful mirror of what Charlotte will dial.
 *
 * Read-only. Returns rows sorted by callback time (soonest first). Past-due
 * rows are kept (status 'overdue' is derived client-side) so the operator can
 * see a callback that hasn't fired yet.
 */
export async function GET() {
  if (!hasSupabase()) return NextResponse.json({ callbacks: [] });

  // Require an authenticated session (the page lives behind the client app).
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseServer();
  // leads_rdv is OCC's single prod data table (no org_id column — same access
  // pattern as the /api/calls lead enrichment). RAPPEL + a set rappel_rdv =
  // a scheduled AI callback.
  const { data, error } = await admin
    .from("leads_rdv")
    .select("id, nom, numero_telephone, qualification, rappel_rdv")
    .eq("qualification", "RAPPEL")
    .not("rappel_rdv", "is", null)
    .order("rappel_rdv", { ascending: true })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const callbacks = ((data ?? []) as Array<{
    id: string;
    nom: string | null;
    numero_telephone: string | null;
    rappel_rdv: string | null;
  }>)
    .filter((r) => r.rappel_rdv)
    .map((r) => ({
      id: r.id,
      name: r.nom,
      e164: r.numero_telephone,
      scheduled_for: r.rappel_rdv as string,
    }));

  return NextResponse.json({ callbacks });
}
