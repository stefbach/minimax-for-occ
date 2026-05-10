import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serverClient: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the service role key.
 * Has full DB access and bypasses RLS — never import from client components.
 */
export function supabaseServer(): SupabaseClient {
  if (serverClient) return serverClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env vars missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.",
    );
  }
  serverClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serverClient;
}

export function hasSupabase(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
