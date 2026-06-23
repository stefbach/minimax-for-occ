// GET /api/dashboard/nhs-suivi/my-queue — patients assigned to the logged-in
// coordinator. Joins the modern auth user (via email) to legacy public.users.id
// and returns the open dashboard_assignments rows + lead detail.

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase-auth";
import { nhsLegacyClient } from "@/lib/nhs-legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MyQueuePatient = {
  lead_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  assigned_at: string | null;
  reason: string | null;
  dossier_status: string | null;
  dossier_completion_pct: number | null;
  documents_received: number;
};

export type MyQueueResponse = {
  ok: boolean;
  user: { id: string | null; email: string | null; full_name: string | null; is_coordinator: boolean } | null;
  patients: MyQueuePatient[];
};

export async function GET(): Promise<NextResponse<MyQueueResponse>> {
  const me = await currentUser();
  const email = me?.email?.trim().toLowerCase() ?? null;
  if (!email) {
    return NextResponse.json({ ok: false, user: null, patients: [] }, { status: 401 });
  }

  const legacy = nhsLegacyClient();

  // 1. Resolve the modern auth user to a legacy coordinator row by email.
  // axon_coordinators_ro is a SECURITY DEFINER view that exposes only
  // is_nhs_coordinator=true users to the anon key.
  const { data: legacyUser } = await legacy
    .from("axon_coordinators_ro")
    .select("id, full_name, email")
    .ilike("email", email)
    .maybeSingle();

  if (!legacyUser) {
    return NextResponse.json({
      ok: true,
      user: { id: null, email, full_name: null, is_coordinator: false },
      patients: [],
    });
  }
  // The view only exposes flagged coordinators, so presence == is_coordinator=true.
  const userRow = legacyUser as { id: string; full_name: string | null; email: string | null };
  const isCoordinator = true;

  // 2. Open assignments for this user. We prefer assigned_to_user_id but fall
  // back to the legacy name string match so older rows still surface.
  const firstNameLower = (userRow.full_name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const { data: assigns } = await legacy
    .from("axon_assignments_ro")
    .select("lead_id, assigned_to, assigned_to_user_id, reason, assigned_at, status")
    .order("assigned_at", { ascending: false })
    .limit(2000);
  type Assign = {
    lead_id: string;
    assigned_to: string | null;
    assigned_to_user_id: string | null;
    reason: string | null;
    assigned_at: string | null;
    status: string | null;
  };
  const latestPerLead = new Map<string, Assign>();
  for (const a of (assigns ?? []) as Assign[]) {
    if (!a.lead_id || latestPerLead.has(a.lead_id)) continue;
    latestPerLead.set(a.lead_id, a);
  }
  const mine = [...latestPerLead.values()].filter((a) => {
    if (a.status && a.status !== "open") return false;
    if (a.assigned_to_user_id) return a.assigned_to_user_id === userRow.id;
    return firstNameLower !== "" && (a.assigned_to ?? "").trim().toLowerCase() === firstNameLower;
  });

  if (mine.length === 0) {
    return NextResponse.json({
      ok: true,
      user: { id: userRow.id, email: userRow.email, full_name: userRow.full_name, is_coordinator: isCoordinator },
      patients: [],
    });
  }

  // 3. Fetch lead + dossier detail for the lead_ids in batches.
  const leadIds = mine.map((m) => m.lead_id);
  const leadById = new Map<string, { nom: string | null; numero_telephone: string | null; email: string | null }>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data: rows } = await legacy
      .from("leads_rdv")
      .select("id, nom, numero_telephone, email")
      .in("id", leadIds.slice(i, i + 200));
    for (const r of (rows ?? []) as Array<{ id: string; nom: string | null; numero_telephone: string | null; email: string | null }>) {
      leadById.set(String(r.id), { nom: r.nom, numero_telephone: r.numero_telephone, email: r.email });
    }
  }
  const dossierByLead = new Map<string, { dossier_status: string | null; dossier_completion_pct: number | null }>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data: rows } = await legacy
      .from("axon_nhs_dossiers_ro")
      .select("lead_id, dossier_status, dossier_completion_pct")
      .in("lead_id", leadIds.slice(i, i + 200));
    for (const r of (rows ?? []) as Array<{ lead_id: string; dossier_status: string | null; dossier_completion_pct: number | null }>) {
      dossierByLead.set(String(r.lead_id), { dossier_status: r.dossier_status, dossier_completion_pct: r.dossier_completion_pct });
    }
  }
  // Count how many real docs each patient has registered — a quick "X/11" the UI uses.
  const docCountByLead = new Map<string, number>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data: rows } = await legacy
      .from("nhs_documents")
      .select("lead_id")
      .in("lead_id", leadIds.slice(i, i + 200));
    for (const r of (rows ?? []) as Array<{ lead_id: string }>) {
      docCountByLead.set(String(r.lead_id), (docCountByLead.get(String(r.lead_id)) ?? 0) + 1);
    }
  }

  const patients: MyQueuePatient[] = mine.map((a) => {
    const lead = leadById.get(String(a.lead_id));
    const dossier = dossierByLead.get(String(a.lead_id));
    return {
      lead_id: String(a.lead_id),
      name: lead?.nom ?? null,
      phone: lead?.numero_telephone ?? null,
      email: lead?.email ?? null,
      assigned_at: a.assigned_at,
      reason: a.reason,
      dossier_status: dossier?.dossier_status ?? null,
      dossier_completion_pct: dossier?.dossier_completion_pct ?? null,
      documents_received: docCountByLead.get(String(a.lead_id)) ?? 0,
    };
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: userRow.id,
      email: userRow.email,
      full_name: userRow.full_name,
      is_coordinator: isCoordinator,
    },
    patients,
  });
}
