import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Seed campaign_targets from the rows of a tenant data table (e.g. leads_rdv).
 *
 * For each row:
 *   • upsert a lightweight contacts "shim" (org_id + e164) — the dialer reads
 *     the phone from contacts, so a shim is needed even though the real data
 *     lives in the physical table.
 *   • create a campaign_target whose `payload` = the row (so {{nom}}, {{bmi}},
 *     … resolve at call time) and whose `source_metadata` records the physical
 *     table + row id so the agent can WRITE BACK to the real table.
 */
export async function ingestDataTableTargets(
  sb: SupabaseClient,
  org_id: string,
  campaign_id: string,
  opts: {
    physical_table: string;
    phone_column: string;
    name_column: string | null;
  },
): Promise<{ inserted: number; skipped: number }> {
  const { data: rows, error } = await sb
    .from(opts.physical_table)
    .select("*")
    .limit(20000);
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return { inserted: 0, skipped: 0 };

  // Build {e164, name, payload, row_id} from each physical row.
  const prepared = rows
    .map((row) => {
      const r = row as Record<string, unknown>;
      const phoneRaw = r[opts.phone_column];
      const e164 = (phoneRaw == null ? "" : String(phoneRaw)).trim();
      if (!e164) return null;
      const normalized = e164.startsWith("+") ? e164 : `+${e164.replace(/[^0-9]/g, "")}`;
      const name = opts.name_column && r[opts.name_column] != null ? String(r[opts.name_column]) : null;
      return { e164: normalized, name, payload: r, row_id: r.id as string | undefined };
    })
    .filter((x): x is { e164: string; name: string | null; payload: Record<string, unknown>; row_id: string | undefined } => Boolean(x));

  if (prepared.length === 0) return { inserted: 0, skipped: rows.length };

  // Upsert shim contacts.
  const { data: contacts, error: cErr } = await sb
    .from("contacts")
    .upsert(
      prepared.map((p) => ({ org_id, e164: p.e164, display_name: p.name })),
      { onConflict: "org_id,e164" },
    )
    .select("id,e164");
  if (cErr) throw new Error(cErr.message);
  const contactByE164 = new Map<string, string>();
  for (const c of contacts ?? []) contactByE164.set(c.e164 as string, c.id as string);

  const targetRows = prepared
    .map((p) => {
      const contact_id = contactByE164.get(p.e164);
      if (!contact_id) return null;
      return {
        campaign_id,
        contact_id,
        status: "pending" as const,
        payload: p.payload,
        source: "data_table",
        source_metadata: {
          physical_table: opts.physical_table,
          row_id: p.row_id ?? null,
          phone_column: opts.phone_column,
        },
      };
    })
    .filter((x) => Boolean(x));

  if (targetRows.length === 0) return { inserted: 0, skipped: prepared.length };

  const { error: tErr } = await sb
    .from("campaign_targets")
    .upsert(targetRows as object[], { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });
  if (tErr) throw new Error(tErr.message);
  return { inserted: targetRows.length, skipped: rows.length - targetRows.length };
}

/**
 * Upsert contacts and create campaign_targets in bulk.
 * Shared between POST /api/campaigns (initial seed) and
 * POST /api/campaigns/[id]/targets (re-import).
 */
export async function ingestTargets(
  sb: SupabaseClient,
  org_id: string,
  campaign_id: string,
  rows: Array<{ e164: string; name?: string | null }>,
): Promise<{ inserted: number }> {
  const cleaned = rows
    .map((r) => ({
      e164: (r.e164 || "").trim(),
      name: (r.name ?? "").toString().trim() || null,
    }))
    .filter((r) => r.e164.length > 0);
  if (cleaned.length === 0) return { inserted: 0 };

  const { data: contacts, error: contactErr } = await sb
    .from("contacts")
    .upsert(
      cleaned.map((r) => ({
        org_id,
        e164: r.e164,
        display_name: r.name,
      })),
      { onConflict: "org_id,e164" },
    )
    .select("id,e164");
  if (contactErr) throw new Error(contactErr.message);

  const map = new Map<string, string>();
  for (const c of contacts ?? []) map.set(c.e164 as string, c.id as string);

  const targetRows = cleaned
    .map((r) => {
      const contact_id = map.get(r.e164);
      if (!contact_id) return null;
      return { campaign_id, contact_id, status: "pending" as const };
    })
    .filter((x): x is { campaign_id: string; contact_id: string; status: "pending" } => Boolean(x));

  if (targetRows.length === 0) return { inserted: 0 };

  const { error: insertErr } = await sb
    .from("campaign_targets")
    .upsert(targetRows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });
  if (insertErr) throw new Error(insertErr.message);
  return { inserted: targetRows.length };
}
