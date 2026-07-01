// Best-effort mirror of nhs_dossiers writes into the LEGACY Supabase project
// (kgohjmivilsfoewrcovn), which is what /api/dashboard/nhs-suivi reads. The
// automation runs against the main project's leads_rdv/nhs_dossiers, but the
// two projects share the same leads_rdv primary keys (verified: lead UUIDs
// match across both DBs) with independent nhs_dossiers rows — so every patch
// here is applied by lead_id, not by dossier id.

const LEGACY_URL = process.env.NHS_LEGACY_SUPABASE_URL ?? "https://kgohjmivilsfoewrcovn.supabase.co";
const LEGACY_KEY = process.env.NHS_LEGACY_SERVICE_KEY;

/** Patch the legacy leads_rdv row (by id) — used for WhatsApp opt-outs so the
 * dashboard's "Abandons" count sees them. Never throws. */
export async function mirrorLeadPatch(leadId: string, patch: Record<string, unknown>): Promise<void> {
  if (!LEGACY_KEY || !leadId || Object.keys(patch).length === 0) return;
  const headers = {
    apikey: LEGACY_KEY,
    Authorization: `Bearer ${LEGACY_KEY}`,
    "Content-Type": "application/json",
  };
  try {
    await fetch(`${LEGACY_URL}/rest/v1/leads_rdv?id=eq.${encodeURIComponent(leadId)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    /* best effort */
  }
}

/** Upsert a dossier patch into the legacy project, keyed by lead_id. Never throws. */
export async function mirrorDossierPatch(leadId: string, patch: Record<string, unknown>): Promise<void> {
  if (!LEGACY_KEY || !leadId || Object.keys(patch).length === 0) return;
  const headers = {
    apikey: LEGACY_KEY,
    Authorization: `Bearer ${LEGACY_KEY}`,
    "Content-Type": "application/json",
  };
  try {
    const existingRes = await fetch(
      `${LEGACY_URL}/rest/v1/nhs_dossiers?lead_id=eq.${encodeURIComponent(leadId)}&select=id`,
      { headers, signal: AbortSignal.timeout(15_000) },
    );
    if (!existingRes.ok) return;
    const existing = (await existingRes.json()) as Array<{ id: string }>;
    if (existing.length > 0) {
      await fetch(`${LEGACY_URL}/rest/v1/nhs_dossiers?id=eq.${existing[0].id}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(15_000),
      });
    } else {
      await fetch(`${LEGACY_URL}/rest/v1/nhs_dossiers`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ lead_id: leadId, dossier_status: "NO_DOCUMENTS_RECEIVED", ...patch }),
        signal: AbortSignal.timeout(15_000),
      });
    }
  } catch {
    /* best effort — a mirror failure must never break the pipeline */
  }
}
