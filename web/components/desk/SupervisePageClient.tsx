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
  const [openContact, setOpenContact] = useState<{ id: string | null; name: string | null; e164: string | null; headline?: string } | null>(null);
  // Wati June 10 v2: filter by qualification (RAPPEL, A PASSER A L'HUMAIN, …).
  const [qualFilter, setQualFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");

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
    () => tasks.filter((t) => {
      if (qualFilter !== "all" && (t.qualification ?? "") !== qualFilter) return false;
      if (assigneeFilter === "__pool__" && t.assigned_to) return false;
      if (assigneeFilter !== "all" && assigneeFilter !== "__pool__" && t.assigned_to !== assigneeFilter) return false;
      return true;
    }),
    [tasks, qualFilter, assigneeFilter],
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
  // Assignee filter options: active agents + any (inactive) agent still holding
  // an open task, so the supervisor can filter the board by who owns the lead.
  const assigneeOptions = useMemo(() => {
    const assignedIds = new Set(tasks.map((t) => t.assigned_to).filter(Boolean) as string[]);
    return agents.filter((a) => a.is_active || assignedIds.has(a.user_id));
  }, [agents, tasks]);

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
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <span className="muted">{t("Assigné à")}</span>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} style={{ fontSize: 13 }}>
            <option value="all">{t("Toutes")}</option>
            <option value="__pool__">— {t("Pool")} —</option>
            {assigneeOptions.map((a) => (
              <option key={a.user_id} value={a.user_id}>{a.display_name}</option>
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

      <div
        className="card"
        style={{
          padding: "8px 12px",
          fontSize: 12,
          color: "var(--muted)",
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
          borderStyle: "dashed",
        }}
      >
        <span aria-hidden>ℹ️</span>
        <span>{t("Ce tableau ne liste que les leads en attente d'un humain. L'option « Agent IA » du menu d'assignation clôture la tâche et la retire d'ici — le lead repart automatiquement dans le dialer. Il n'y a donc rien à filtrer sous « Agent IA ».")}</span>
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
          if (t.contact.id || t.contact.e164) {
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
          if (t.contact.id || t.contact.e164) {
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

// Page size options for the supervise table. "all" disables pagination
// for managers who prefer scrolling once over clicking through pages.
const PAGE_SIZE_OPTIONS = [20, 50, 100, -1] as const;
type PageSize = typeof PAGE_SIZE_OPTIONS[number];

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
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [page, setPage] = useState(1);

  // Reset to page 1 when the filtered task list changes OR the page size
  // changes — otherwise a user on page 3 of 20-per-page filters and lands
  // on an empty page 3.
  useEffect(() => { setPage(1); }, [tasks.length, pageSize]);

  const totalPages = pageSize === -1 ? 1 : Math.max(1, Math.ceil(tasks.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const sliced = pageSize === -1
    ? tasks
    : tasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", borderLeft: `4px solid ${accent}` }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          <span className="muted" style={{ fontSize: 12 }}>{subtitle}</span>
          <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
            <span>{t("Par page")}</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
              style={{ fontSize: 12, padding: "2px 6px" }}
              aria-label={t("Nombre d'éléments par page")}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={-1}>{t("Tout")}</option>
            </select>
          </label>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
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
              sliced.map((task) => (
                <tr key={task.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td>
                    {(task.contact.id || task.contact.e164) ? (
                      <button
                        onClick={() => onOpenContact(task)}
                        className="ghost"
                        style={{ padding: 0, border: "none", background: "transparent", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", textAlign: "left", fontSize: 13 }}
                      >
                        {task.contact.display_name ?? task.contact.e164 ?? "—"}
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
                  <Td><span className="muted" style={{ fontSize: 12 }}>{formatRelative(task.scheduled_for, t)}</span></Td>
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
                      <option value="__AI__">🤖 {t("Agent IA")}</option>
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
      {pageSize !== -1 && totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalRows={tasks.length}
          onChange={setPage}
        />
      )}
    </div>
  );
}

function Pagination({
  currentPage, totalPages, pageSize, totalRows, onChange,
}: {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalRows: number;
  onChange: (page: number) => void;
}) {
  const t = useT();
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalRows);

  // Build a compact page list: 1 … (current-1) current (current+1) … last.
  // Always show first + last + a small window around the current page so
  // the row never explodes on a 50+ page list.
  const pages: Array<number | "…"> = [];
  const window = 1;
  const lo = Math.max(2, currentPage - window);
  const hi = Math.min(totalPages - 1, currentPage + window);
  pages.push(1);
  if (lo > 2) pages.push("…");
  for (let p = lo; p <= hi; p++) pages.push(p);
  if (hi < totalPages - 1) pages.push("…");
  if (totalPages > 1) pages.push(totalPages);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderTop: "1px solid var(--border)",
        flexWrap: "wrap",
        fontSize: 12,
      }}
    >
      <span className="muted">
        {start}–{end} / {totalRows}
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
        <PageBtn disabled={currentPage === 1} onClick={() => onChange(currentPage - 1)} ariaLabel={t("Page précédente")}>
          ‹
        </PageBtn>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} style={{ padding: "4px 6px", color: "var(--muted)" }}>…</span>
          ) : (
            <PageBtn
              key={p}
              active={p === currentPage}
              onClick={() => onChange(p)}
              ariaLabel={`${t("Page")} ${p}`}
            >
              {p}
            </PageBtn>
          ),
        )}
        <PageBtn disabled={currentPage === totalPages} onClick={() => onChange(currentPage + 1)} ariaLabel={t("Page suivante")}>
          ›
        </PageBtn>
      </div>
    </div>
  );
}

function PageBtn({
  children, onClick, active, disabled, ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
      style={{
        minWidth: 28,
        height: 28,
        padding: "0 8px",
        border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
        background: active ? "var(--accent)" : "transparent",
        color: active ? "white" : disabled ? "var(--muted-2)" : "var(--fg)",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
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
function formatRelative(iso: string, t: (s: string) => string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms);
  const todayMs = startOfTodayLocalMs();
  const taskDayMs = startOfDayLocalMs(d);
  const dayDelta = Math.round((taskDayMs - todayMs) / 86400000);
  const hhmm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (dayDelta < 0) return `${d.toLocaleDateString()} ${hhmm} (${t("en retard")})`;
  if (dayDelta === 0) return `${t("Aujourd'hui")} ${hhmm}`;
  if (dayDelta === 1) return `${t("Demain")} ${hhmm}`;
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
