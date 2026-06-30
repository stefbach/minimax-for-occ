import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { nhsLegacyClient } from "@/lib/nhs-legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight feed for the universal "assign a team member" control.
//
// Returns the org's NHS coordinators (Summer / Rain / Stormi) plus every open
// assignment, keyed by lead_id AND by the patient's corrected dossier name so
// the dropdown can show who a patient is currently assigned to wherever the
// name appears — including the static NHS_REPORT patients that only carry a
// name (no lead_id) on the client.

export type AssignmentRow = {
  lead_id: string;
  name: string | null; // corrected dossier name when available, else leads_rdv.nom
  coordinator: string; // titled, e.g. "Rain"
};

export type AssignmentsResponse = {
  coordinators: string[]; // titled, in Summer / Rain / Stormi order
  assignments: AssignmentRow[];
};

const COORDINATOR_ORDER = ["summer", "rain", "stormi"];

function titleCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export async function GET(request: Request) {
  await requestOrgId(request); // dashboard is behind login
  const legacy = nhsLegacyClient();

  // ── Coordinators (Summer / Rain / Stormi) ───────────────────────────────
  const coordByUserId = new Map<string, string>(); // id -> titled name
  const coordByFirstName = new Map<string, string>(); // first name lc -> titled
  try {
    const { data: coords } = await legacy
      .from("axon_coordinators_ro")
      .select("id, full_name, email");
    for (const c of (coords ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      const raw = (c.full_name ?? c.email ?? "").trim();
      if (!raw) continue;
      const titled = titleCase(raw.split(/\s+/)[0]);
      coordByUserId.set(c.id, titled);
      coordByFirstName.set(titled.toLowerCase(), titled);
    }
  } catch { /* coordinators unreachable */ }

  const coordinators = [...coordByFirstName.values()].sort((a, b) => {
    const ia = COORDINATOR_ORDER.indexOf(a.toLowerCase());
    const ib = COORDINATOR_ORDER.indexOf(b.toLowerCase());
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
  });

  // ── Open assignments (latest per lead) ──────────────────────────────────
  const assignments: AssignmentRow[] = [];
  try {
    const { data: assigns } = await legacy
      .from("axon_assignments_ro")
      .select("lead_id, assigned_to, assigned_to_user_id, assigned_at, status")
      .order("assigned_at", { ascending: false })
      .limit(2000);
    type Assign = {
      lead_id: string;
      assigned_to: string | null;
      assigned_to_user_id: string | null;
      assigned_at: string | null;
      status: string | null;
    };
    const latestPerLead = new Map<string, Assign>();
    for (const a of (assigns ?? []) as Assign[]) {
      if (!a.lead_id || latestPerLead.has(a.lead_id)) continue;
      latestPerLead.set(a.lead_id, a);
    }
    const open = [...latestPerLead.values()].filter(
      (a) => (a.assigned_to_user_id || a.assigned_to) && (!a.status || a.status === "open"),
    );

    const leadIds = open.map((a) => String(a.lead_id));
    // Prefer the corrected dossier name; fall back to leads_rdv.nom.
    const nameByLead = new Map<string, string>();
    for (let i = 0; i < leadIds.length; i += 200) {
      const slice = leadIds.slice(i, i + 200);
      const { data: dossiers } = await legacy
        .from("nhs_dossiers")
        .select("lead_id, nom")
        .in("lead_id", slice);
      for (const d of (dossiers ?? []) as Array<{ lead_id: string; nom: string | null }>) {
        if (d.lead_id && d.nom) nameByLead.set(String(d.lead_id), d.nom);
      }
      const { data: leads } = await legacy
        .from("leads_rdv")
        .select("id, nom")
        .in("id", slice);
      for (const l of (leads ?? []) as Array<{ id: string; nom: string | null }>) {
        if (l.id && l.nom && !nameByLead.has(String(l.id))) nameByLead.set(String(l.id), l.nom);
      }
    }

    for (const a of open) {
      const coordinator =
        (a.assigned_to_user_id && coordByUserId.get(a.assigned_to_user_id)) ||
        coordByFirstName.get((a.assigned_to ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "") ||
        (a.assigned_to ? titleCase(a.assigned_to.trim()) : null);
      if (!coordinator) continue;
      assignments.push({
        lead_id: String(a.lead_id),
        name: nameByLead.get(String(a.lead_id)) ?? null,
        coordinator,
      });
    }
  } catch { /* assignments unreachable */ }

  return NextResponse.json({ coordinators, assignments } satisfies AssignmentsResponse);
}
