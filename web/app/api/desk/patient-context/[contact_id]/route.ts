import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/patient-context/[contact_id]
 *
 * For human agents on the /desk workstation. Given a contact id, finds the
 * org's primary leads table (registered in `tenant_data_tables`, label/key
 * matching /leads_rdv|nhs|patient/i — first match) and returns the
 * patient-context row matched on phone number.
 *
 * Multi-tenant safe:
 *   - the contact lookup is filtered by org_id;
 *   - the leads-table lookup is filtered by org_id;
 *   - the row lookup is filtered through the registered table whose org is
 *     already validated.
 *
 * Gracefully degrades to `{ context: null, table_label: null }` when:
 *   - the org has no registered leads table,
 *   - or there is no matching row for the contact's phone number.
 *
 * Columns are read defensively — if the org's table doesn't have a given
 * column, the corresponding `PatientContext` field is just null.
 */

type Nullable<T> = T | null;

export type PatientContext = {
  identity: { nom: Nullable<string>; email: Nullable<string>; dob: Nullable<string> };
  clinical: {
    bmi: Nullable<number>;
    poids: Nullable<number>;
    taille: Nullable<number>;
    allergies: Nullable<string>;
    anesthesia_allergies: Nullable<string>;
    current_medications: Nullable<string>;
    past_surgeries: Nullable<string>;
    other_chronic_conditions: Nullable<string>;
  };
  nhs: {
    wmp_status: Nullable<string>;
    wmp_details: Nullable<string>;
    document_status: Nullable<string>;
    received_documents: Nullable<string>;
    missing_documents: Nullable<string>;
  };
  history: {
    qualification: Nullable<string>;
    call_count: number;
    last_call: Nullable<string>;
    last_response: Nullable<string>;
    cycle_status: Nullable<string>;
    current_phase: Nullable<string>;
  };
  notes: {
    call_1: Nullable<string>;
    call_2: Nullable<string>;
    call_3: Nullable<string>;
    free: Nullable<string>;
  };
  source: { source_lead: Nullable<string>; form_facebook: Nullable<string> };
};

export type PatientContextResponse = {
  context: PatientContext | null;
  table_label: string | null;
};

// First column in each list = canonical OCC prod name; fallbacks accept legacy
// demo names. Lookup happens per-column against the row; first non-undefined
// (i.e. column exists on the table) wins.
const COL_ALIASES: Record<string, readonly string[]> = {
  nom: ["nom", "name", "display_name", "full_name", "patient_name"],
  email: ["email", "patient_email"],
  dob: ["patient_dob", "dob", "date_of_birth"],

  bmi: ["bmi", "imc"],
  poids: ["poids", "weight"],
  taille: ["taille", "height"],
  allergies: ["allergies"],
  anesthesia_allergies: ["anesthesia_allergies", "allergies_anesthesie"],
  current_medications: ["current_medications", "medications", "traitements"],
  past_surgeries: ["past_surgeries", "anciennes_chirurgies", "antecedents_chirurgicaux"],
  other_chronic_conditions: [
    "other_chronic_conditions",
    "chronic_conditions",
    "antecedents",
  ],

  wmp_status: ["nhs_wmp_status", "wmp_status"],
  wmp_details: ["nhs_wmp_details", "wmp_details"],
  document_status: ["document_status"],
  received_documents: ["received_documents", "documents_recus"],
  missing_documents: ["missing_documents", "documents_manquants"],

  qualification: ["qualification"],
  last_call: ["last_call_datetime", "last_call_at", "last_call"],
  last_response: ["last_response_date", "last_qualification_update"],
  cycle_status: ["cycle_status"],
  current_phase: ["current_phase"],

  call_1_note: ["call_1_note", "note_call_1"],
  call_2_note: ["call_2_note", "note_call_2"],
  call_3_note: ["call_3_note", "note_call_3"],
  free_note: ["notes", "note", "free_note"],

  source_lead: ["source_lead", "source"],
  form_facebook: ["form_facebook", "facebook_form", "fb_form"],
};

function pick<T = unknown>(row: Record<string, unknown>, keys: readonly string[]): T | null {
  for (const k of keys) {
    if (k in row) {
      const v = row[k];
      if (v !== null && v !== undefined && v !== "") return v as T;
    }
  }
  return null;
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.length > 0 ? v : null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  return null;
}
function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// E.164 phone normalization: produce both the leading-+ form and the
// digits-only form so we catch tables that store one or the other.
function phoneVariants(e164: string | null): string[] {
  if (!e164) return [];
  const trimmed = e164.trim();
  if (!trimmed) return [];
  const noPlus = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const withPlus = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  const out = new Set<string>([trimmed, noPlus, withPlus]);
  return Array.from(out);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ contact_id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json<PatientContextResponse>({ context: null, table_label: null });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { contact_id } = await params;
  if (!contact_id) {
    return NextResponse.json({ error: "contact_id required" }, { status: 400 });
  }

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  // 1. Look up the contact's phone number (multi-tenant filter on org_id).
  const { data: contact, error: contactErr } = await admin
    .from("contacts")
    .select("id, e164")
    .eq("id", contact_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (contactErr) {
    return NextResponse.json({ error: contactErr.message }, { status: 500 });
  }
  if (!contact || !contact.e164) {
    return NextResponse.json<PatientContextResponse>({ context: null, table_label: null });
  }

  // 2. Locate the org's primary leads table.
  const { data: tables } = await admin
    .from("tenant_data_tables")
    .select("physical_table, label, phone_column")
    .eq("org_id", orgId);
  const candidate =
    (tables ?? []).find((t) => {
      const label = (t as { label: string | null }).label ?? "";
      const phys = (t as { physical_table: string }).physical_table ?? "";
      return /leads_rdv|nhs|patient/i.test(label) || /leads_rdv|nhs|patient/i.test(phys);
    }) ?? null;
  if (!candidate) {
    return NextResponse.json<PatientContextResponse>({ context: null, table_label: null });
  }
  const table = (candidate as { physical_table: string }).physical_table;
  const tableLabel =
    (candidate as { label: string | null }).label ?? table;
  const phoneCol =
    ((candidate as { phone_column: string | null }).phone_column ?? "numero_telephone") ||
    "numero_telephone";

  // 3. SELECT the row for the contact's phone number (try both formats).
  const variants = phoneVariants(contact.e164 as string);
  let row: Record<string, unknown> | null = null;
  try {
    const { data } = await admin
      .from(table)
      .select("*")
      .in(phoneCol, variants)
      .limit(1)
      .maybeSingle();
    row = (data as Record<string, unknown> | null) ?? null;
  } catch {
    row = null;
  }

  if (!row) {
    return NextResponse.json<PatientContextResponse>({
      context: null,
      table_label: tableLabel,
    });
  }

  // 4. Map generic field names to whatever the table has (tolerant).
  const context: PatientContext = {
    identity: {
      nom: asString(pick(row, COL_ALIASES.nom)),
      email: asString(pick(row, COL_ALIASES.email)),
      dob: asString(pick(row, COL_ALIASES.dob)),
    },
    clinical: {
      bmi: asNumber(pick(row, COL_ALIASES.bmi)),
      poids: asNumber(pick(row, COL_ALIASES.poids)),
      taille: asNumber(pick(row, COL_ALIASES.taille)),
      allergies: asString(pick(row, COL_ALIASES.allergies)),
      anesthesia_allergies: asString(pick(row, COL_ALIASES.anesthesia_allergies)),
      current_medications: asString(pick(row, COL_ALIASES.current_medications)),
      past_surgeries: asString(pick(row, COL_ALIASES.past_surgeries)),
      other_chronic_conditions: asString(pick(row, COL_ALIASES.other_chronic_conditions)),
    },
    nhs: {
      wmp_status: asString(pick(row, COL_ALIASES.wmp_status)),
      wmp_details: asString(pick(row, COL_ALIASES.wmp_details)),
      document_status: asString(pick(row, COL_ALIASES.document_status)),
      received_documents: asString(pick(row, COL_ALIASES.received_documents)),
      missing_documents: asString(pick(row, COL_ALIASES.missing_documents)),
    },
    history: {
      qualification: asString(pick(row, COL_ALIASES.qualification)),
      call_count: await callCountForContact(admin, orgId, contact_id),
      last_call: asString(pick(row, COL_ALIASES.last_call)),
      last_response: asString(pick(row, COL_ALIASES.last_response)),
      cycle_status: asString(pick(row, COL_ALIASES.cycle_status)),
      current_phase: asString(pick(row, COL_ALIASES.current_phase)),
    },
    notes: {
      call_1: asString(pick(row, COL_ALIASES.call_1_note)),
      call_2: asString(pick(row, COL_ALIASES.call_2_note)),
      call_3: asString(pick(row, COL_ALIASES.call_3_note)),
      free: asString(pick(row, COL_ALIASES.free_note)),
    },
    source: {
      source_lead: asString(pick(row, COL_ALIASES.source_lead)),
      form_facebook: asString(pick(row, COL_ALIASES.form_facebook)),
    },
  };

  return NextResponse.json<PatientContextResponse>({
    context,
    table_label: tableLabel,
  });
}

async function callCountForContact(
  admin: ReturnType<typeof supabaseServer>,
  orgId: string,
  contactId: string,
): Promise<number> {
  try {
    const { count } = await admin
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("contact_id", contactId);
    return count ?? 0;
  } catch {
    return 0;
  }
}
