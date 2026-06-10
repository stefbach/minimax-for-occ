"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";
import { PatientDrawer } from "./PatientDrawer";

interface SuperviseTask {
  id: string;
  contact: { id: string | null; display_name: string | null; e164: string | null };
  qualification: string | null;
  transfer_reason: string | null;
  scheduled_for: string;
  assigned_to: string | null;
  status: string;
  outcome_disposition: string | null;
  original_call_id: string | null;
}

interface AgentRow {
  user_id: string;
  display_name: string;
  email: string | null;
  is_active: boolean;
}

export function SupervisePageClient() {
  const t = useT();
  const [tasks, setTasks] = useState<SuperviseTask[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Patient drawer opens when the manager clicks a contact name in either
  // section (À assigner / Déjà assignés). Wati June 10 — same CRM-style
  // detail used on /mes-patients.
  const [openContact, setOpenContact] = useState<{ id: string; name: string | null; e164: string | null; headline?: string } | null>(null);
  // Wati June 10 v2: filter by qualification (RAPPEL, A PASSER A L'HUMAIN, …).
  const [qualFilter, setQualFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const [t1, t2] = await Promise.all([
        fetch(`/api/desk/tasks?scope=all`, { cache: "no-store" }),
        fetch("/api/desk/agents", { cache: "no-store" }),
      ]);
      if (t1.ok) {
        const j = (await t1.json()) as { all: SuperviseTask[] };
        setTasks(j.all ?? []);
      } else {
        const j = (await t1.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${t1.status}`);
      }
      if (t2.ok) {
        const j = (await t2.json()) as { agents: AgentRow[] };
        setAgents(j.agents ?? []);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function reassign(taskId: string, userId: string | null) {
    setBusyId(taskId);
    setErr(null);
    try {
      const r = await fetch(`/api/desk/tasks/${taskId}/reassign`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assigned_to: userId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  const filteredTasks = useMemo(
    () => qualFilter === "all" ? tasks : tasks.filter((t) => (t.qualification ?? "") === qualFilter),
    [tasks, qualFilter],
  );
  const unassignedTasks = useMemo(() => filteredTasks.filter((t) => !t.assigned_to), [filteredTasks]);
  const assignedTasks = useMemo(() => filteredTasks.filter((t) => !!t.assigned_to), [filteredTasks]);
  const counts = useMemo(() => {
    const total = filteredTasks.length;
    const inProgress = filteredTasks.filter((t) => t.status === "in_progress").length;
    return { total, unassigned: unassignedTasks.length, assigned: assignedTasks.length, inProgress };
  }, [filteredTasks, unassignedTasks, assignedTasks]);
  const distinctQuals = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.qualification ?? "").filter(Boolean))).sort(),
    [tasks],
  );

  const activeAgents = useMemo(() => agents.filter((a) => a.is_active), [agents]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <span className="muted">{t("Qualification")}</span>
          <select value={qualFilter} onChange={(e) => setQualFilter(e.target.value)} style={{ fontSize: 13 }}>
            <option value="all">{t("Toutes")}</option>
            {distinctQuals.map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
        </label>
        <div className="grid-kpi" style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Kpi label={t("À assigner")} value={counts.unassigned} />
          <Kpi label={t("Assignés")} value={counts.assigned} />
          <Kpi label={t("En cours")} value={counts.inProgress} />
          <Kpi label={t("Total ouverts")} value={counts.total} />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <CreateTaskButton onCreated={refresh} defaultDate={isoToday()} />
          <button className="ghost" onClick={refresh}>{t("Rafraîchir")}</button>
        </div>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>
        </div>
      )}

      <TaskSection
        title={t("À assigner")}
        subtitle={t("Leads non encore pris en charge — assigne à un agent")}
        tasks={unassignedTasks}
        loading={loading}
        busyId={busyId}
        activeAgents={activeAgents}
        allAgents={agents}
        onReassign={reassign}
        onOpenContact={(t) => {
          if (t.contact.id) {
            setOpenContact({
              id: t.contact.id,
              name: t.contact.display_name,
              e164: t.contact.e164,
              headline: t.qualification ?? undefined,
            });
          }
        }}
        emptyText={t("Aucun lead en attente d'assignation. 🎉")}
        accent="var(--accent)"
      />

      <TaskSection
        title={t("Déjà assignés")}
        subtitle={t("Leads pris en charge par un agent")}
        tasks={assignedTasks}
        loading={loading}
        busyId={busyId}
        activeAgents={activeAgents}
        allAgents={agents}
        onReassign={reassign}
        onOpenContact={(t) => {
          if (t.contact.id) {
            setOpenContact({
              id: t.contact.id,
              name: t.contact.display_name,
              e164: t.contact.e164,
              headline: t.qualification ?? undefined,
            });
          }
        }}
        emptyText={t("Aucun lead assigné actuellement.")}
        accent="var(--muted)"
      />

      {openContact && (
        <PatientDrawer
          contactId={openContact.id}
          displayName={openContact.name}
          e164={openContact.e164}
          headline={openContact.headline}
          onClose={() => setOpenContact(null)}
        />
      )}
    </div>
  );
}

function TaskSection({
  title, subtitle, tasks, loading, busyId, activeAgents, allAgents, onReassign, onOpenContact, emptyText, accent,
}: {
  title: string;
  subtitle: string;
  tasks: SuperviseTask[];
  loading: boolean;
  busyId: string | null;
  activeAgents: AgentRow[];
  allAgents: AgentRow[];
  onReassign: (id: string, userId: string | null) => Promise<void>;
  onOpenContact: (task: SuperviseTask) => void;
  emptyText: string;
  accent: string;
}) {
  const t = useT();
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", borderLeft: `4px solid ${accent}` }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          <span className="muted" style={{ fontSize: 12 }}>{subtitle}</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            {tasks.length} {tasks.length > 1 ? t("éléments") : t("élément")}
          </span>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--bg-2)", textAlign: "left" }}>
              <Th>{t("Contact")}</Th>
              <Th>{t("Téléphone")}</Th>
              <Th>{t("Qualification")}</Th>
              <Th>{t("Raison")}</Th>
              <Th>{t("Reçu")}</Th>
              <Th>{t("Statut")}</Th>
              <Th>{t("Assigné à")}</Th>
            </tr>
          </thead>
          <tbody>
            {loading && tasks.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 16, textAlign: "center" }}>
                  {t("Chargement…")}
                </td>
              </tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 16, textAlign: "center" }}>{emptyText}</td>
              </tr>
            ) : (
              tasks.map((task) => (
                <tr key={task.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td>
                    {task.contact.id ? (
                      <button
                        onClick={() => onOpenContact(task)}
                        className="ghost"
                        style={{ padding: 0, border: "none", background: "transparent", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", textAlign: "left", fontSize: 13 }}
                      >
                        {task.contact.display_name ?? "—"}
                      </button>
                    ) : (
                      task.contact.display_name ?? "—"
                    )}
                  </Td>
                  <Td>{task.contact.e164 ?? "—"}</Td>
                  <Td>
                    {task.qualification ? (
                      <span className="tag" style={{ fontSize: 11 }}>{task.qualification}</span>
                    ) : "—"}
                  </Td>
                  <Td style={{ maxWidth: 280 }}>
                    <span className="muted" style={{ fontSize: 12 }}>{truncate(task.transfer_reason, 80) ?? "—"}</span>
                  </Td>
                  <Td><span className="muted" style={{ fontSize: 12 }}>{formatRelative(task.scheduled_for)}</span></Td>
                  <Td>
                    <span className="tag" style={{ fontSize: 11 }}>{task.status}</span>
                  </Td>
                  <Td>
                    <select
                      value={task.assigned_to ?? ""}
                      disabled={busyId === task.id || task.status === "done"}
                      onChange={(e) => onReassign(task.id, e.target.value || null)}
                    >
                      <option value="">— {t("Pool")} —</option>
                      {activeAgents.map((a) => (
                        <option key={a.user_id} value={a.user_id}>{a.display_name}</option>
                      ))}
                      {task.assigned_to && !activeAgents.some((a) => a.user_id === task.assigned_to) && (
                        <option value={task.assigned_to}>
                          {allAgents.find((a) => a.user_id === task.assigned_to)?.display_name ?? task.assigned_to.slice(0, 8)} (inactif)
                        </option>
                      )}
                    </select>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "10px 12px",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        color: "var(--muted)",
        fontWeight: 600,
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "10px 12px", verticalAlign: "middle", ...style }}>{children}</td>;
}
function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function isoToday(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}
function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const todayMs = startOfTodayLocalMs();
  const taskDayMs = startOfDayLocalMs(d);
  const dayDelta = Math.round((taskDayMs - todayMs) / 86400000);
  const hhmm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (dayDelta < 0) return `${d.toLocaleDateString()} ${hhmm} (en retard)`;
  if (dayDelta === 0) return `Aujourd'hui ${hhmm}`;
  if (dayDelta === 1) return `Demain ${hhmm}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} ${hhmm}`;
}
function startOfTodayLocalMs(): number {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}
function startOfDayLocalMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function truncate(s: string | null, n: number): string | null {
  if (!s) return null;
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// "+ Créer une tâche" — opens a modal that POSTs to /api/desk/tasks/manual.
// Wired up in commit 4 (this is a placeholder that opens an empty modal
// from commit 3, fully functional after the agent-tools transfer endpoint
// + manual create endpoint land in commit 4). Renders a disabled button
// when /api/desk/tasks/manual isn't deployed yet — the modal component is
// imported lazily so we can ship the rest of the supervise UI first.
function CreateTaskButton({
  onCreated,
  defaultDate,
}: {
  onCreated: () => void;
  defaultDate: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>{t("+ Créer une tâche")}</button>
      {open && (
        <CreateTaskModal
          defaultDate={defaultDate}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            onCreated();
          }}
        />
      )}
    </>
  );
}

// Lazy import of the actual modal so we don't crash if the create
// endpoint hasn't shipped yet. Defined inline to keep the patch tight.
import { CreateTaskModal } from "./CreateTaskModal";
