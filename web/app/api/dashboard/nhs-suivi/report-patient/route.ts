import { NextResponse } from "next/server";
import { requestOrgId } from "@/lib/request-org";
import { nhsLegacyClient } from "@/lib/nhs-legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Returns all documents for a NHS report patient matched by name.
// Used by NhsReportDetailView to show real files from Supabase Storage.

export type ReportPatientDoc = {
  id: string;
  file_name: string;
  doc_field: string | null;
  category: string | null;
  public_url: string;
  file_size: number | null;
  mime_type: string | null;
};

export type ReportPatientResponse = {
  dossier_id: string;
  lead_id: string;
  nom: string;
  docs: ReportPatientDoc[];
};

export async function GET(request: Request) {
  await requestOrgId(request);
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "name param required" }, { status: 400 });

  const legacy = nhsLegacyClient();

  // Find dossier by name — try exact match first, then ilike
  const { data: exact } = await legacy
    .from("nhs_dossiers")
    .select("id, lead_id, nom")
    .ilike("nom", name)
    .maybeSingle();

  let dossier = exact;

  if (!dossier) {
    // Fuzzy: match on first + last word of the name
    const parts = name.split(/\s+/);
    const first = parts[0];
    const last = parts[parts.length - 1];
    const { data: fuzzy } = await legacy
      .from("nhs_dossiers")
      .select("id, lead_id, nom")
      .ilike("nom", `%${first}%`)
      .ilike("nom", `%${last}%`)
      .maybeSingle();
    dossier = fuzzy;
  }

  if (!dossier) {
    return NextResponse.json({ error: "Dossier introuvable" }, { status: 404 });
  }

  // Fetch all documents for this dossier
  const { data: docs, error: docErr } = await legacy
    .from("nhs_documents")
    .select("id, file_name, doc_field, category, public_url, file_size, mime_type")
    .eq("dossier_id", dossier.id)
    .not("public_url", "is", null)
    .order("doc_field", { ascending: true })
    .order("file_name", { ascending: true });

  if (docErr) throw docErr;

  return NextResponse.json({
    dossier_id: dossier.id,
    lead_id: dossier.lead_id,
    nom: dossier.nom,
    docs: docs ?? [],
  } satisfies ReportPatientResponse);
}
