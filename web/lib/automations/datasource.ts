import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase";

/**
 * Per-automation data source.
 *
 * Workflow definitions, credentials and run logs live in the Axon app DB
 * (supabaseServer()). The *patient pipeline* data — leads_rdv, nhs_dossiers,
 * nhs_documents, the OCC_Patient storage bucket and the render-pdf edge
 * function — lives in a separate Supabase project (the one the historical n8n
 * flows used). An automation declares which project its rows live in via
 * trigger.data_source_credential_id, pointing at an org_credentials row of
 * kind 'supabase_data' holding { url, service_key }.
 *
 * When no data source is set we fall back to the app DB, so legacy workflows
 * (and anything operating purely on app tables) keep working unchanged.
 */

export interface DataSource {
  /** Supabase client scoped to the project that owns the patient rows. */
  client: SupabaseClient;
  /** Project REST/base URL, e.g. https://xxxx.supabase.co (no trailing slash). */
  url: string;
  /** Service-role key for storage uploads / edge-function calls. */
  serviceKey: string;
}

const cache = new Map<string, SupabaseClient>();

/** Build (or reuse) a Supabase client for a 'supabase_data' credential. */
export function dataSourceFromCredential(cred: Record<string, unknown>): DataSource {
  const url = String(cred.url ?? cred.base_url ?? "").replace(/\/+$/, "");
  const serviceKey = String(cred.service_key ?? cred.service_role ?? cred.key ?? "");
  if (!url || !serviceKey) {
    throw new Error("supabase_data credential missing url/service_key");
  }
  const cacheKey = `${url}|${serviceKey.slice(0, 12)}`;
  let client = cache.get(cacheKey);
  if (!client) {
    client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    cache.set(cacheKey, client);
  }
  return { client, url, serviceKey };
}

/**
 * Resolve the data source for a run. If credentialId is given we load that
 * 'supabase_data' credential from the app DB and connect to the patient
 * project; otherwise we return the app DB itself (no url/serviceKey — only the
 * client is usable for plain table ops).
 */
export async function resolveDataSource(
  orgId: string,
  credentialId: string | null | undefined,
): Promise<DataSource> {
  if (!credentialId) {
    return { client: supabaseServer(), url: "", serviceKey: "" };
  }
  const sb = supabaseServer();
  const { data } = await sb
    .from("org_credentials")
    .select("kind, data")
    .eq("id", credentialId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) throw new Error(`data source credential ${credentialId} not found`);
  if (data.kind !== "supabase_data") {
    throw new Error(`credential ${credentialId} is not a supabase_data credential`);
  }
  return dataSourceFromCredential(data.data as Record<string, unknown>);
}
