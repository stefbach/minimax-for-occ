import type { SupabaseClient } from "@supabase/supabase-js";

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
