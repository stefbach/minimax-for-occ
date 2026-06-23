import type { SupabaseClient } from "@supabase/supabase-js";
import type { DataSource } from "./datasource";

/**
 * Shared run context + credential loader.
 *
 * Lives apart from engine.ts so the heavy OCC compound steps (steps-occ.ts)
 * can use the same context and credential cache without importing the engine
 * (which would create a cycle: engine → steps-occ → engine).
 */
export interface RunCtx {
  orgId: string;
  /** Patient-pipeline data source (or the app DB when none is set). */
  ds: DataSource;
  /** App DB — where org_credentials live. */
  app: SupabaseClient;
  creds: Map<string, Record<string, unknown>>;
  stats: {
    matched: number;
    actions: number;
    skipped: number;
    errors: number;
    log: Array<{ at: string; level: "info" | "warn" | "error"; msg: string }>;
    output?: Record<string, unknown>;
  };
  log: (level: "info" | "warn" | "error", msg: string) => void;
  /** Re-entrancy guard for call_automation. */
  depth: number;
  /** Workflow id — set when enqueuing review-mode management actions. */
  workflowId?: string;
  /** Current run id (nullable link on queued actions). */
  runId?: string | null;
  /** Management agent powering ai_email/ai_whatsapp/ai_update_row steps. */
  agent?: { id: string; llm_provider: string; llm_model: string; system_prompt: string } | null;
  /** 'auto' = AI steps send immediately; 'review' = enqueue for approval. */
  approvalMode?: "auto" | "review";
}

/** Load a credential (merged kind + secret data) from the app DB, cached per run. */
export async function loadCredential(
  rc: RunCtx,
  credentialId: string,
): Promise<Record<string, unknown> | null> {
  if (rc.creds.has(credentialId)) {
    const c = rc.creds.get(credentialId)!;
    return c._missing ? null : c;
  }
  const { data } = await rc.app
    .from("org_credentials")
    .select("kind, data")
    .eq("id", credentialId)
    .eq("org_id", rc.orgId)
    .maybeSingle();
  if (!data) {
    rc.creds.set(credentialId, { _missing: true });
    return null;
  }
  const merged = { kind: data.kind, ...(data.data as Record<string, unknown>) };
  rc.creds.set(credentialId, merged);
  return merged;
}
