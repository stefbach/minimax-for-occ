import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { nextBusinessDayAt } from "@/lib/next-business-day";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERVISOR_ROLES = new Set([
  "super_admin",
  "owner",
  "admin",
  "manager",
  "supervisor",
]);

/**
 * POST /api/desk/tasks/manual
 *   { contact_id, qualification, scheduled_for? }
 *
 * Supervisor-only: creates a human_callback_task manually (no IA in the
 * loop). transferred_by_agent_id is NULL and transfer_reason is set to
 * the literal "manual" so downstream reporting can distinguish manual
 * vs IA-driven follow-ups.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !SUPERVISOR_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    contact_id?: string;
    qualification?: string;
    scheduled_for?: string;
    notes?: string;
  } | null;
  if (!body?.contact_id) {
    return NextResponse.json({ error: "contact_id required" }, { status: 400 });
  }
  if (!body.qualification || !body.qualification.trim()) {
    return NextResponse.json({ error: "qualification required" }, { status: 400 });
  }

  let scheduledFor: Date;
  if (body.scheduled_for && body.scheduled_for.trim()) {
    const ts = Date.parse(body.scheduled_for);
    if (!Number.isFinite(ts)) {
      return NextResponse.json({ error: "invalid scheduled_for" }, { status: 400 });
    }
    scheduledFor = new Date(ts);
  } else {
    scheduledFor = nextBusinessDayAt();
  }

  const admin = supabaseServer();
  // Sanity: contact must belong to the same org.
  const { data: c, error: cErr } = await admin
    .from("contacts")
    .select("id, org_id, display_name, e164")
    .eq("id", body.contact_id)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!c || (c as { org_id: string }).org_id !== orgId) {
    return NextResponse.json({ error: "contact not found in this org" }, { status: 400 });
  }
  const contactRow = c as { display_name: string | null; e164: string | null };

  const { data, error } = await admin
    .from("human_callback_tasks")
    .insert({
      org_id: orgId,
      contact_id: body.contact_id,
      transferred_by_agent_id: null,
      qualification: body.qualification.trim(),
      transfer_reason: "manual",
      scheduled_for: scheduledFor.toISOString(),
      notes: body.notes?.trim() ?? null,
      status: "pending",
      // Dénormalisation 15/06 — assure que les colonnes sont remplies
      // dès la création pour le superviseur, même si le row contacts
      // perd ses détails plus tard.
      display_name: contactRow.display_name,
      e164: contactRow.e164,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task_id: (data as { id: string }).id });
}
