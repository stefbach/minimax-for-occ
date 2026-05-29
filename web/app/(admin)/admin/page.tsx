import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

type OrgStatus = "active" | "suspended" | "archived" | "pending_deletion";

interface PlatformStats {
  clients_total: number;
  clients_active: number;
  clients_suspended: number;
  clients_archived: number;
  clients_pending_deletion: number;
  members_total: number;
  calls_7d: number;
  voices_cloned: number;
  campaigns_active: number;
}

interface AuditEntry {
  id: number;
  created_at: string;
  org_id: string | null;
  org_name: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Axon super_admin dashboard.
 *
 * Surfaces platform-wide health at a glance: client counts by lifecycle
 * status, recent activity (last 20 audit events), and shortcuts to the
 * common ops pages. Replaces the legacy /admin page which used to host
 * per-org user management — that workflow now belongs to the client app
 * (org owner / manager) and will move there in a follow-up.
 */
export default async function AdminDashboard() {
  let stats: PlatformStats = {
    clients_total: 0,
    clients_active: 0,
    clients_suspended: 0,
    clients_archived: 0,
    clients_pending_deletion: 0,
    members_total: 0,
    calls_7d: 0,
    voices_cloned: 0,
    campaigns_active: 0,
  };
  let recent: AuditEntry[] = [];
  let supabaseDown = !hasSupabase();

  if (!supabaseDown) {
    try {
      const sb = supabaseServer();
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

      const [
        clientsByStatus,
        membersCount,
        callsCount,
        voicesCount,
        campaignsCount,
        auditRows,
      ] = await Promise.all([
        sb.from("organizations").select("status"),
        sb.from("memberships").select("id", { count: "exact", head: true }),
        sb.from("calls").select("id", { count: "exact", head: true }).gte("started_at", since),
        sb.from("voices").select("id", { count: "exact", head: true }).eq("source", "cloned"),
        sb.from("campaigns").select("id", { count: "exact", head: true }).eq("state", "running"),
        sb
          .from("audit_log")
          .select("id, created_at, org_id, actor_user_id, actor_role, action, resource_type, resource_id, metadata")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      const statuses = ((clientsByStatus.data as Array<{ status: OrgStatus | null }>) ?? []).map(
        (r) => r.status ?? "active",
      );
      stats = {
        clients_total: statuses.length,
        clients_active: statuses.filter((s) => s === "active").length,
        clients_suspended: statuses.filter((s) => s === "suspended").length,
        clients_archived: statuses.filter((s) => s === "archived").length,
        clients_pending_deletion: statuses.filter((s) => s === "pending_deletion").length,
        members_total: membersCount.count ?? 0,
        calls_7d: callsCount.count ?? 0,
        voices_cloned: voicesCount.count ?? 0,
        campaigns_active: campaignsCount.count ?? 0,
      };

      // Enrich audit rows with org name + actor email (single round-trip each).
      const rawAudit = (auditRows.data as Array<Omit<AuditEntry, "org_name" | "actor_email">>) ?? [];
      const orgIds = Array.from(new Set(rawAudit.map((r) => r.org_id).filter((x): x is string => !!x)));
      const userIds = Array.from(new Set(rawAudit.map((r) => r.actor_user_id).filter((x): x is string => !!x)));

      const [orgs, users] = await Promise.all([
        orgIds.length
          ? sb.from("organizations").select("id, name").in("id", orgIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
        userIds.length
          ? sb.auth.admin.listUsers({ page: 1, perPage: 200 })
          : Promise.resolve({ data: { users: [] as Array<{ id: string; email?: string }> } }),
      ]);

      const orgMap = new Map((orgs.data ?? []).map((o) => [o.id, o.name]));
      const userMap = new Map(
        (users.data?.users ?? [])
          .filter((u) => userIds.includes(u.id))
          .map((u) => [u.id, u.email ?? null]),
      );

      recent = rawAudit.map((r) => ({
        ...r,
        org_name: r.org_id ? orgMap.get(r.org_id) ?? null : null,
        actor_email: r.actor_user_id ? userMap.get(r.actor_user_id) ?? null : null,
      }));
    } catch (e) {
      console.error("[admin-dashboard]", e);
      supabaseDown = true;
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            Vue d&apos;ensemble Axon{" "}
            <span className="tag" style={{ marginLeft: 8 }}>super_admin</span>
          </h1>
          <div className="subtitle">
            État de la plateforme et activité récente sur tous les clients.
          </div>
        </div>
        <HelpButton contextKey="admin" />
      </div>

      {supabaseDown ? (
        <div className="card" style={{ color: "var(--bad)" }}>
          Supabase indisponible — impossible d&apos;afficher les stats. Vérifie les variables
          d&apos;environnement <span className="kbd">SUPABASE_URL</span> et{" "}
          <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span>.
        </div>
      ) : (
        <>
          {/* ─── Platform tiles ──────────────────────────────────────── */}
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
            <Tile
              label="Clients actifs"
              value={stats.clients_active}
              hint={`${stats.clients_total} au total`}
              href="/admin/orgs"
              accent="good"
            />
            <Tile
              label="Suspendus"
              value={stats.clients_suspended}
              hint="Login bloqué, data préservée"
              href="/admin/orgs"
              accent={stats.clients_suspended > 0 ? "warn" : "muted"}
            />
            <Tile
              label="Archivés"
              value={stats.clients_archived}
              hint="Lecture seule, sans billing"
              href="/admin/orgs"
              accent="muted"
            />
            <Tile
              label="En suppression"
              value={stats.clients_pending_deletion}
              hint="Grâce RGPD 30j"
              href="/admin/orgs"
              accent={stats.clients_pending_deletion > 0 ? "bad" : "muted"}
            />
            <Tile
              label="Membres totaux"
              value={stats.members_total}
              hint="Tous clients confondus"
              accent="muted"
            />
            <Tile
              label="Appels (7j)"
              value={stats.calls_7d}
              hint="Volume plateforme"
              accent="muted"
            />
            <Tile
              label="Voix clonées"
              value={stats.voices_cloned}
              hint="MiniMax custom voices"
              accent="muted"
            />
            <Tile
              label="Campagnes actives"
              value={stats.campaigns_active}
              hint="En cours sur la plateforme"
              accent="muted"
            />
          </section>

          {/* ─── Audit log live ──────────────────────────────────────── */}
          <section>
            <div className="page-header" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>Activité récente (audit log)</h2>
                <div className="subtitle">
                  20 dernières actions sensibles sur la plateforme. Mise à jour à chaque refresh.
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {recent.length === 0 ? (
                <div style={{ padding: 16, color: "var(--muted)" }}>
                  Aucune activité encore enregistrée. Les actions admin (création de client,
                  suspension, suppression…) apparaîtront ici en temps réel.
                </div>
              ) : (
                <table className="list">
                  <thead>
                    <tr>
                      <th>Quand</th>
                      <th>Action</th>
                      <th>Qui</th>
                      <th>Client</th>
                      <th>Détails</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((e) => (
                      <tr key={e.id}>
                        <td style={{ color: "var(--muted)", fontSize: 13, whiteSpace: "nowrap" }}>
                          {formatRelative(e.created_at)}
                        </td>
                        <td>
                          <span className="kbd" style={{ fontSize: 12 }}>{e.action}</span>
                        </td>
                        <td style={{ fontSize: 13 }}>
                          {e.actor_email ?? <span style={{ color: "var(--muted)" }}>—</span>}
                          {e.actor_role && (
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>{e.actor_role}</div>
                          )}
                        </td>
                        <td style={{ fontSize: 13 }}>
                          {e.org_name ?? <span style={{ color: "var(--muted)" }}>plateforme</span>}
                        </td>
                        <td style={{ fontSize: 12, color: "var(--muted)" }}>
                          {summarizeMetadata(e.metadata, e.resource_type)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  href,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  href?: string;
  accent?: "good" | "warn" | "bad" | "muted";
}) {
  const color =
    accent === "good" ? "var(--good, #4ade80)"
    : accent === "warn" ? "#fbbf24"
    : accent === "bad" ? "var(--bad)"
    : "inherit";

  const content = (
    <div className="card" style={{ padding: 16, height: "100%" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 600, color, marginTop: 4 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      {content}
    </Link>
  ) : (
    content
  );
}

function formatRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60_000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `il y a ${d}j`;
    return new Date(iso).toLocaleDateString("fr-FR");
  } catch {
    return iso;
  }
}

function summarizeMetadata(metadata: Record<string, unknown>, resourceType: string | null): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return resourceType ?? "—";
  }
  // Pick the 2-3 most useful fields to display inline.
  const keys = ["name", "email", "role", "new_status", "category", "slug", "voice_id"];
  const parts: string[] = [];
  for (const k of keys) {
    if (k in metadata && metadata[k] != null && metadata[k] !== "") {
      parts.push(`${k}: ${String(metadata[k])}`);
    }
    if (parts.length >= 3) break;
  }
  return parts.length > 0 ? parts.join(" · ") : resourceType ?? "—";
}
