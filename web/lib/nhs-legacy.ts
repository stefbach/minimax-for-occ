import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Connection to the LEGACY dashboard's Supabase project (emerald-ocean),
// where the OCC NHS workflow writes: leads_rdv comms/doc columns,
// nhs_dossiers (via the axon_nhs_dossiers_ro view) and
// dashboard_assignments (via axon_assignments_ro). See
// app/api/dashboard/nhs-suivi/route.ts for the full rationale.

export const NHS_LEGACY_URL =
  process.env.NHS_LEGACY_SUPABASE_URL ?? "https://kgohjmivilsfoewrcovn.supabase.co";
// Publishable anon key (public by design — same key the legacy frontend ships).
export const NHS_LEGACY_KEY =
  process.env.NHS_LEGACY_SUPABASE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtnb2hqbWl2aWxzZm9ld3Jjb3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcxNTMxMDYsImV4cCI6MjA2MjcyOTEwNn0.E_eRu1s2vpGNDNIF1L_I6T9UQsTtKKQaU94oZISpmws";

export function nhsLegacyClient(): SupabaseClient {
  return createClient(NHS_LEGACY_URL, NHS_LEGACY_KEY, { auth: { persistSession: false } });
}
