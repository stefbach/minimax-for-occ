import { supabaseServer } from "@/lib/supabase";

/**
 * Append a row to the audit_log table. Server-only (uses the service-role
 * client). Never throws — audit failure must not break the action it
 * records, so errors are logged and swallowed.
 *
 * The audit_log policies allow inserts only via service_role, which is
 * what supabaseServer() returns.
 */
export interface AuditEvent {
  /** Organization the action targets/affects. Null for platform-wide events. */
  orgId: string | null;
  /** auth.users.id of the human who triggered the action. */
  actorUserId: string;
  /** Snapshot of the actor's role at action time (super_admin, manager, ...). */
  actorRole: string;
  /** Dotted action key. Examples: 'org.created', 'org.suspended',
   *  'org.deletion_scheduled', 'campaign.launched', 'voice.deleted',
   *  'user.invited', 'recording.listened'. */
  action: string;
  /** Optional resource the action acted on (e.g. 'organization', 'campaign'). */
  resourceType?: string;
  /** Optional id of that resource. */
  resourceId?: string;
  /** Arbitrary context (diff, old/new values, ...). */
  metadata?: Record<string, unknown>;
  /** Original request — we extract IP + user-agent from it. */
  req?: Request;
}

function extractIp(req: Request | undefined): string | null {
  if (!req) return null;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

export async function logAudit(evt: AuditEvent): Promise<void> {
  try {
    const sb = supabaseServer();
    await sb.from("audit_log").insert({
      org_id: evt.orgId,
      actor_user_id: evt.actorUserId,
      actor_role: evt.actorRole,
      action: evt.action,
      resource_type: evt.resourceType ?? null,
      resource_id: evt.resourceId ?? null,
      metadata: evt.metadata ?? {},
      ip_address: extractIp(evt.req),
      user_agent: evt.req?.headers.get("user-agent") ?? null,
    });
  } catch (e) {
    // Audit must never break the action. Surface in server logs but swallow.
    console.error("[audit] failed to record event", evt.action, e);
  }
}
