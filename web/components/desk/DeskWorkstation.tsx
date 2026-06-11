"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { dispatchSoftphoneExpand } from "@/components/voice/PersistentSoftphoneShell";
import { useT } from "@/lib/i18n";

/**
 * Two underlying data sources feed this UI:
 *
 *  1. `/api/desk/tasks` — the new "Appels du jour" queue based on the
 *     human_callback_tasks table. Each row is a TASK created by the IA
 *     agent (or manually by an admin) telling a human to call the
 *     patient back the next business day.
 *
 *  2. `/api/desk/queue` — the legacy "anything with a humain/rappel
 *     disposition" queue, materialized from calls.metadata. Kept for
 *     backwards compatibility with calls created before the task-based
 *     workflow shipped; rendered alongside the new tasks in the same
 *     panes.
 *
 * Both shapes are normalized to `DeskItem` for rendering. `kind`
 * distinguishes them so we hit the right endpoints on claim / release /
 * complete.
 */

interface DeskItem {
  kind: "task" | "legacy";
  id: string; // task_id OR call_id
  e164: string | null;
  display_name: string | null;
  call_count: number;
  qualification: string | null;
  transfer_reason: string | null; // task-only
  scheduled_for: string | null; // task-only
  assigned_to: string | null;
  status: string | null; // task-only
  last_note: string | null;
  original_call_id: string | null;
  original_call_summary: string | null;
  contact_id: string | null;
}

interface TasksResponse {
  personal: TaskRow[];
  shared: TaskRow[];
  done_today: TaskRow[];
}
interface TaskRow {
  id: string;
  contact: { id: string | null; display_name: string | null; e164: string | null };
  qualification: string | null;
  transfer_reason: string | null;
  scheduled_for: string;
  assigned_to: string | null;
  status: string;
  notes: string | null;
  outcome_disposition: string | null;
  call_count: number;
  original_call_summary: string | null;
  original_call_id: string | null;
  last_note: string | null;
}

interface LegacyQueueResponse {
  personal: LegacyCall[];
  shared: LegacyCall[];
}
interface LegacyCall {
  id: string;
  e164: string | null;
  display_name: string | null;
  last_call_at: string | null;
  disposition: string | null;
  qualification: string | null;
  call_count: number;
  last_note: string | null;
  human_callback_at: string | null;
  assigned_to: string | null;
}

const QUALIFICATIONS = [
  "rdv_pris",
  "rdv_reporte",
  "non_qualifie",
  "qualifie_chaud",
  "qualifie_tiede",
  "qualifie_froid",
  "voicemail",
  "refus",
  "dnc",
];

/**
 * /desk re-built as a 3-pane workstation:
 *
 *   ┌────────────┬──────────────────────┬────────────┐
 *   │ Appels du  │ Patient + Softphone  │ Pool       │
 *   │  jour      │ + Disposition form   │ partagé    │
 *   └────────────┴──────────────────────┴────────────┘
 *
 * The Softphone component stays the single source of truth for outbound
 * dialing — we just pass it ?prefill= via the URL so the dial pad is
 * pre-loaded and the agent reviews the patient context before clicking
 * ☎ Appeler.
 *
 * Mobile (≤900px): a top toggle picks "Mes appels" or "File équipe"
 * because three panes side-by-side don't fit.
 */
export function DeskWorkstation() {
  const t = useT();
  const [tasks, setTasks] = useState<TasksResponse>({
    personal: [],
    shared: [],
    done_today: [],
  });
  const [legacy, setLegacy] = useState<LegacyQueueResponse>({
    personal: [],
    shared: [],
  });
  const [loading, setLoading] = useState(true);
  const [focused, setFocused] = useState<{ kind: DeskItem["kind"]; id: string } | null>(null);
  const [mobileView, setMobileView] = useState<"personal" | "shared">("personal");
  // Pagination — "Voir plus" loads 10 more rows. Keeps the queues short
  // by default so the agent never scrolls a wall of names.
  const [personalLimit, setPersonalLimit] = useState(10);
  const [sharedLimit, setSharedLimit] = useState(10);
  const [claimBusy, setClaimBusy] = useState<string | null>(null);
  const [releaseBusy, setReleaseBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);

  // ── Normalize both sources into a single render shape ─────────────────
  const personal: DeskItem[] = useMemo(() => {
    return [
      ...tasks.personal.map(taskToItem),
      ...legacy.personal.map(legacyToItem),
    ];
  }, [tasks.personal, legacy.personal]);
  const shared: DeskItem[] = useMemo(() => {
    // Dedupe by (contact_id || e164) — when test campaigns hammer the same
    // patient multiple times the legacy queue keeps every call as its own
    // row, which buries real leads under 20+ identical phone numbers. Keep
    // the freshest entry per contact and roll up the rest into call_count.
    const raw = [
      ...tasks.shared.map(taskToItem),
      ...legacy.shared.map(legacyToItem),
    ];
    const byContact = new Map<string, DeskItem>();
    for (const item of raw) {
      const key = item.contact_id || item.e164 || `${item.kind}:${item.id}`;
      const existing = byContact.get(key);
      if (!existing) {
        byContact.set(key, item);
      } else {
        // Prefer task entries over legacy (richer metadata) and the most
        // recently scheduled. Increment call_count to show the total
        // attempts on the surviving card.
        const incomingFresher =
          (item.scheduled_for ?? "") > (existing.scheduled_for ?? "") ||
          (item.kind === "task" && existing.kind === "legacy");
        if (incomingFresher) {
          byContact.set(key, {
            ...item,
            call_count: (existing.call_count || 0) + (item.call_count || 0),
          });
        } else {
          existing.call_count =
            (existing.call_count || 0) + (item.call_count || 0);
        }
      }
    }
    return Array.from(byContact.values());
  }, [tasks.shared, legacy.shared]);
  const doneToday: DeskItem[] = useMemo(
    () => tasks.done_today.map(taskToItem),
    [tasks.done_today],
  );

  const focusedItem = useMemo(() => {
    if (!focused) return null;
    const all = [...personal, ...shared, ...doneToday];
    return all.find((c) => c.kind === focused.kind && c.id === focused.id) ?? null;
  }, [personal, shared, doneToday, focused]);

  // ── Sync the dial pad prefill to the focused row ──────────────────────
  useEffect(() => {
    if (!focusedItem?.e164) return;
    const sp = new URLSearchParams(window.location.search);
    sp.set("prefill", focusedItem.e164);
    if (focusedItem.display_name) sp.set("name", focusedItem.display_name);
    else sp.delete("name");
    sp.delete("call");
    const url = `${window.location.pathname}?${sp.toString()}`;
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [focusedItem?.id, focusedItem?.e164, focusedItem?.display_name]);

  // ── Refresh both endpoints ────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const [t1, t2] = await Promise.all([
        fetch("/api/desk/tasks", { cache: "no-store" }),
        fetch("/api/desk/queue", { cache: "no-store" }),
      ]);
      if (t1.ok) {
        const j = (await t1.json()) as TasksResponse;
        setTasks(j);
      }
      if (t2.ok) {
        const j = (await t2.json()) as LegacyQueueResponse;
        setLegacy(j);
      }
    } catch {
      /* best-effort */
    } finally {
      setLoading(false);
    }
  }, []);

  // Trigger the morning round-robin distribution once per session — the
  // server endpoint is idempotent (debounced per UTC day) so calling it
  // unconditionally is safe and silent.
  useEffect(() => {
    fetch("/api/desk/tasks/auto-distribute", { method: "POST" }).catch(() => {});
  }, []);

  // /desk is the agent's primary workspace, so we auto-open the full
  // softphone drawer when they land here. The layout-level shell handles
  // the actual state. Wati 2026-06-11 — Softphone moved from a desk grid
  // cell to a persistent shell so calls survive navigation.
  useEffect(() => {
    dispatchSoftphoneExpand();
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function claim(item: DeskItem) {
    setClaimBusy(item.id);
    setActionErr(null);
    try {
      const url =
        item.kind === "task"
          ? `/api/desk/tasks/${item.id}/claim`
          : "/api/desk/claim";
      const body =
        item.kind === "task" ? undefined : JSON.stringify({ call_id: item.id });
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      setFocused({ kind: item.kind, id: item.id });
      await refresh();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setClaimBusy(null);
    }
  }

  async function release(item: DeskItem) {
    setReleaseBusy(item.id);
    setActionErr(null);
    try {
      const url =
        item.kind === "task"
          ? `/api/desk/tasks/${item.id}/release`
          : "/api/desk/release";
      const body =
        item.kind === "task" ? undefined : JSON.stringify({ call_id: item.id });
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      if (focused?.id === item.id) setFocused(null);
      await refresh();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReleaseBusy(null);
    }
  }

  const personalCount = personal.length;
  const sharedCount = shared.length;
  const doneCount = doneToday.length;
  // Apply pagination — "Voir plus" reveals 10 extra rows at a time.
  // Wati's spec: lists must stay short by default; long ones get a
  // dedicated /mes-patients page.
  const personalVisible = personal.slice(0, personalLimit);
  const sharedVisible = shared.slice(0, sharedLimit);
  const personalHasMore = personal.length > personalLimit;
  const sharedHasMore = shared.length > sharedLimit;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Mobile-only toggle */}
      <div
        className="desk-mobile-toggle"
        style={{ display: "none", gap: 8 }}
      >
        <button
          className={mobileView === "personal" ? "" : "ghost"}
          onClick={() => setMobileView("personal")}
        >
          {t("Mes appels")} ({personalCount})
        </button>
      </div>

      {actionErr && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <div style={{ color: "var(--bad)", fontSize: 13 }}>{actionErr}</div>
        </div>
      )}

      {/* Daily briefing removed June 10 v3 (Wati): now that the shared
          pool is handled by Supervision, the briefing 'X leads dans le
          pool partagé' is misleading. The Mes appels column already
          shows the agent's queue. */}

      {/* 2x2 layout (Wati's spec):
            ┌───────────────────────┬───────────────────────┐
            │  Softphone + dispo    │   Patient details     │  ← TOP
            │  (poste de l'agent)   │   (résumé / transc /  │
            │                       │    notes éditables)   │
            ├───────────────────────┼───────────────────────┤
            │  Appels du jour       │   Pool partagé        │  ← BOTTOM
            │  (file perso)         │   (file équipe)       │
            └───────────────────────┴───────────────────────┘
          Click on a name in the bottom row → patient details
          load in the TOP-RIGHT cell.  */}
      <div className="desk-2x2">
        {/* TOP-LEFT — disposition form when a patient is focused. The
            softphone itself moved up into a persistent layout-level shell
            on 2026-06-11 so live calls survive navigation between /desk
            and /mes-patients / /rapports / etc. The drawer auto-opens on
            this page (see dispatchSoftphoneExpand() above) so the agent
            sees the full softphone UI exactly like before. */}
        {focusedItem && (
          <section
            className="desk-pane desk-poste"
            style={{ display: "grid", gap: 12 }}
          >
            <h3 style={{ margin: 0, fontSize: 14, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
              {t("Qualification de l'appel")}
            </h3>
            <DispositionForm
              item={focusedItem}
              onSaved={() => {
                setFocused(null);
                void refresh();
              }}
            />
          </section>
        )}

        {/* TOP-RIGHT — patient details (résumé / transcript / notes).
            Spans both columns when no patient is focused. */}
        {focusedItem && (
          <section className="desk-pane desk-patient" style={{ display: "grid", gap: 12 }}>
            <PatientCard item={focusedItem} />
          </section>
        )}

        {/* BOTTOM-LEFT — personal queue. Spans full row now that
            BOTTOM-RIGHT was removed (Wati June 10 v6). */}
        <aside
          className="card desk-pane"
          data-pane="personal"
          style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, gridColumn: "1 / -1" }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>
              {t("Appels du jour")} ({personalCount + doneCount})
            </h3>
            <span className="muted" style={{ fontSize: 12 }}>
              {t("À traiter")}: {personalCount}
            </span>
          </div>
          {loading && personal.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>{t("Chargement…")}</div>
          ) : personal.length === 0 ? (
            <div style={{ padding: "14px 8px", textAlign: "center", color: "var(--muted)", fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ fontSize: 24, opacity: 0.5, marginBottom: 6 }}>📋</div>
              <div>{t("Aucun appel à traiter")}</div>
              <div style={{ marginTop: 4 }}>{t("Prends-en un dans le Pool partagé →")}</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {personalVisible.map((c) => (
                <QueueRow
                  key={`${c.kind}:${c.id}`}
                  item={c}
                  active={focused?.kind === c.kind && focused?.id === c.id}
                  onClick={() => setFocused({ kind: c.kind, id: c.id })}
                  trailing={
                    <button
                      className="ghost"
                      style={{ padding: "4px 8px", fontSize: 11 }}
                      disabled={releaseBusy === c.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void release(c);
                      }}
                    >
                      {releaseBusy === c.id ? "…" : t("Relâcher")}
                    </button>
                  }
                />
              ))}
              {personalHasMore && (
                <button
                  className="ghost"
                  style={{ padding: "6px 10px", fontSize: 12, marginTop: 4 }}
                  onClick={() => setPersonalLimit((n) => n + 10)}
                >
                  {t("Voir 10 de plus")} ({personalCount - personalLimit} {t("restants")})
                </button>
              )}
            </div>
          )}

          {/* Faits aujourd'hui — collapsible */}
          {doneCount > 0 && (
            <div style={{ marginTop: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <button
                className="ghost"
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", fontSize: 12 }}
                onClick={() => setDoneOpen((v) => !v)}
                aria-expanded={doneOpen}
              >
                <span>{t("Faits aujourd'hui")} ({doneCount})</span>
                <span aria-hidden style={{ opacity: 0.7 }}>{doneOpen ? "▾" : "▸"}</span>
              </button>
              {doneOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                  {doneToday.map((c) => (
                    <QueueRow
                      key={`done:${c.id}`}
                      item={c}
                      active={focused?.kind === c.kind && focused?.id === c.id}
                      onClick={() => setFocused({ kind: c.kind, id: c.id })}
                      dimmed
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>

        {/* BOTTOM-RIGHT slot removed June 10 v6 (Wati): when there's no
            patient focused, the bottom-left 'Appels du jour' spans the
            full row instead of leaving an empty card on the right. */}
      </div>

      <style jsx>{`
        .desk-2x2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: minmax(320px, auto) minmax(320px, auto);
          gap: 14px;
        }
        @media (max-width: 900px) {
          .desk-2x2 {
            grid-template-columns: 1fr;
            grid-template-rows: auto auto auto auto;
          }
          :global(.desk-mobile-toggle) {
            display: flex !important;
          }
          .desk-2x2 [data-pane="personal"] {
            display: ${mobileView === "personal" ? "flex" : "none"};
          }
          .desk-2x2 [data-pane="shared"] {
            display: ${mobileView === "shared" ? "flex" : "none"};
          }
        }
        /* Softphone keeps its internal layout single-column so it doesn't
           fight the 2x2 grid. Hide the duplicated recent-calls + contact
           sidebars to keep the poste compact. */
        .desk-poste :global(.softphone-grid) {
          grid-template-columns: 1fr !important;
        }
        .desk-poste :global(.softphone-left),
        .desk-poste :global(.softphone-right) {
          display: none;
        }
      `}</style>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function taskToItem(t: TaskRow): DeskItem {
  return {
    kind: "task",
    id: t.id,
    e164: t.contact.e164,
    display_name: t.contact.display_name,
    call_count: t.call_count,
    qualification: t.qualification,
    transfer_reason: t.transfer_reason,
    scheduled_for: t.scheduled_for,
    assigned_to: t.assigned_to,
    status: t.status,
    last_note: t.last_note ?? t.notes ?? null,
    original_call_id: t.original_call_id,
    original_call_summary: t.original_call_summary,
    contact_id: t.contact.id,
  };
}
function legacyToItem(c: LegacyCall): DeskItem {
  return {
    kind: "legacy",
    id: c.id,
    e164: c.e164,
    display_name: c.display_name,
    call_count: c.call_count,
    qualification: c.qualification,
    transfer_reason: null,
    scheduled_for: c.human_callback_at,
    assigned_to: c.assigned_to,
    status: null,
    last_note: c.last_note,
    original_call_id: c.id,
    original_call_summary: null,
    contact_id: null,
  };
}

interface TranscriptTurn {
  seq: number;
  speaker: string;
  text: string;
  started_at: string;
}

function TranscriptSection({ callId }: { callId: string }) {
  const t = useT();
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTurns(null);
    setErr(null);
    (async () => {
      try {
        const r = await fetch(`/api/calls/${callId}/transcripts`, { cache: "no-store" });
        if (!r.ok) {
          if (!cancelled) setErr(`HTTP ${r.status}`);
          return;
        }
        const j = (await r.json()) as TranscriptTurn[];
        if (!cancelled) setTurns(j ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "fetch_failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId]);

  if (err) {
    return (
      <div className="muted" style={{ fontSize: 12, paddingTop: 6 }}>
        {t("Transcript indisponible")} ({err})
      </div>
    );
  }
  if (turns === null) {
    return (
      <div className="muted" style={{ fontSize: 12, paddingTop: 6 }}>
        {t("Chargement…")}
      </div>
    );
  }
  if (turns.length === 0) {
    return (
      <div className="muted" style={{ fontSize: 12, paddingTop: 6 }}>
        {t("Aucun transcript pour cet appel.")}
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        paddingTop: 8,
        maxHeight: 320,
        overflowY: "auto",
      }}
    >
      {turns.map((turn) => {
        const isAgent =
          turn.speaker === "agent" ||
          turn.speaker === "assistant" ||
          turn.speaker === "agent_ai";
        return (
          <div
            key={turn.seq}
            style={{
              fontSize: 12,
              lineHeight: 1.45,
              padding: "4px 8px",
              borderRadius: 6,
              background: isAgent ? "var(--bg-2)" : "transparent",
              borderLeft: `3px solid ${isAgent ? "var(--accent)" : "var(--border)"}`,
            }}
          >
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 2 }}
            >
              {isAgent ? t("Agent") : t("Patient")}
            </div>
            <div>{turn.text}</div>
          </div>
        );
      })}
    </div>
  );
}

function AgentNotesEditor({
  taskId,
  initial,
}: {
  taskId: string;
  initial: string;
}) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  // Debounced auto-save: 800ms after the agent stops typing.
  useEffect(() => {
    if (value === initial) return;
    const handle = setTimeout(async () => {
      setSaved("saving");
      setErr(null);
      try {
        const r = await fetch(`/api/desk/tasks/${taskId}/notes`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ notes: value }),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          setSaved("error");
          setErr(j.error ?? `HTTP ${r.status}`);
          return;
        }
        setSaved("saved");
      } catch (e) {
        setSaved("error");
        setErr(e instanceof Error ? e.message : "save_failed");
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [value, taskId, initial]);

  return (
    <div style={{ display: "grid", gap: 6, paddingTop: 8 }}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t(
          "Tape tes notes ici pendant l'appel — auto-enregistré toutes les 800ms.",
        )}
        rows={6}
        style={{
          width: "100%",
          fontSize: 13,
          fontFamily: "inherit",
          lineHeight: 1.5,
          padding: 8,
          resize: "vertical",
        }}
      />
      <div className="muted" style={{ fontSize: 11 }}>
        {saved === "saving" && t("Enregistrement…")}
        {saved === "saved" && t("✓ Enregistré")}
        {saved === "error" && (
          <span style={{ color: "var(--bad)" }}>
            {t("Échec d'enregistrement")} ({err})
          </span>
        )}
        {saved === "idle" && t("Modifications enregistrées automatiquement.")}
      </div>
    </div>
  );
}

function DailyBriefing({
  personalCount,
  sharedCount,
  doneCount,
  firstPersonal,
  firstShared,
  focused,
  onStart,
}: {
  personalCount: number;
  sharedCount: number;
  doneCount: number;
  firstPersonal: DeskItem | null;
  firstShared: DeskItem | null;
  focused: { kind: string; id: string } | null;
  onStart: (item: DeskItem) => void;
}) {
  const t = useT();
  const remaining = personalCount + sharedCount;
  const nextTarget = firstPersonal ?? firstShared;
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t("Bonjour") : hour < 18 ? t("Bon après-midi") : t("Bonsoir");

  let message: string;
  if (remaining === 0) {
    message =
      doneCount > 0
        ? t("Tu as terminé tous les rappels du jour. 🎉")
        : t("Aucun rappel programmé. Tu peux prendre des leads dans le pool partagé.");
  } else if (personalCount > 0) {
    message =
      personalCount === 1
        ? t("Tu as 1 appel personnel à traiter aujourd'hui.")
        : `${t("Tu as")} ${personalCount} ${t("appels personnels à traiter aujourd'hui.")}`;
  } else {
    message = `${sharedCount} ${t("leads dans le pool partagé. Prends-en un pour démarrer.")}`;
  }

  return (
    <div
      className="card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        padding: "14px 16px",
        borderColor: "var(--accent)",
      }}
    >
      <div style={{ flex: "1 1 280px", minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{greeting}.</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          {message}
        </div>
      </div>
      <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <KpiBlock label={t("À traiter")} value={remaining} tone="primary" />
        <KpiBlock label={t("Mes appels")} value={personalCount} />
        <KpiBlock label={t("Pool")} value={sharedCount} />
        <KpiBlock label={t("Faits")} value={doneCount} tone="muted" />
        {!focused && nextTarget && (
          <button
            onClick={() => onStart(nextTarget)}
            style={{ padding: "8px 14px", fontWeight: 600 }}
          >
            {t("Démarrer")} →
          </button>
        )}
      </div>
    </div>
  );
}

function KpiBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "primary" | "muted";
}) {
  const color =
    tone === "primary"
      ? "var(--accent)"
      : tone === "muted"
        ? "var(--muted)"
        : "var(--fg)";
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function QueueRow({
  item,
  active,
  onClick,
  trailing,
  dimmed,
}: {
  item: DeskItem;
  active: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
  dimmed?: boolean;
}) {
  const t = useT();
  const title = item.display_name || item.e164 || "—";
  return (
    <button
      className="ghost"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "var(--bg-2)" : "transparent",
        opacity: dimmed ? 0.7 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        alignItems: "stretch",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <strong style={{ fontSize: 13 }}>{title}</strong>
        {trailing}
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        {item.e164 ?? "—"}
        {item.call_count > 1 ? ` · ${item.call_count} ${t("appels")}` : ""}
      </div>
      {item.qualification && (
        <span className="tag" style={{ fontSize: 10, alignSelf: "flex-start" }}>
          {item.qualification}
        </span>
      )}
      {item.last_note && (
        <div className="muted" style={{ fontSize: 11, fontStyle: "italic" }}>
          “{truncate(item.last_note, 60)}”
        </div>
      )}
      {item.scheduled_for && (
        <div className="muted" style={{ fontSize: 11 }}>
          {t("Rappeler le")} {formatDateTime(item.scheduled_for)}
        </div>
      )}
    </button>
  );
}

// ── Patient context (org-specific leads table join) ──────────────────────
// Shape mirrors /api/desk/patient-context/[contact_id]. Defined here as a
// local type so this component stays self-contained — the endpoint is the
// single source of truth and gates each section silently when fields are
// missing on the org's leads table.

interface PatientContext {
  identity: { nom: string | null; email: string | null; dob: string | null };
  clinical: {
    bmi: number | null;
    poids: number | null;
    taille: number | null;
    allergies: string | null;
    anesthesia_allergies: string | null;
    current_medications: string | null;
    past_surgeries: string | null;
    other_chronic_conditions: string | null;
  };
  nhs: {
    wmp_status: string | null;
    wmp_details: string | null;
    document_status: string | null;
    received_documents: string | null;
    missing_documents: string | null;
  };
  history: {
    qualification: string | null;
    call_count: number;
    last_call: string | null;
    last_response: string | null;
    cycle_status: string | null;
    current_phase: string | null;
  };
  notes: {
    call_1: string | null;
    call_2: string | null;
    call_3: string | null;
    free: string | null;
  };
  source: { source_lead: string | null; form_facebook: string | null };
}

function PatientCard({ item }: { item: DeskItem | null }) {
  const t = useT();
  const [ctx, setCtx] = useState<PatientContext | null>(null);
  // Fetch the org-specific patient context when a row is focused AND has a
  // contact_id. Orgs without a leads table or contacts not in it just leave
  // ctx === null, which falls back to the generic view below.
  useEffect(() => {
    const contactId = item?.contact_id ?? null;
    if (!contactId) {
      setCtx(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/desk/patient-context/${contactId}`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = (await r.json()) as { context: PatientContext | null };
        if (!cancelled) setCtx(j.context ?? null);
      } catch {
        if (!cancelled) setCtx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item?.contact_id]);

  // Wati June 10 v5: when no patient is focused, render nothing. The
  // 'Prêt à prendre un appel' empty-state is shown in the BOTTOM-RIGHT
  // slot of the 2x2 grid instead — keeping it twice (here + bottom-right)
  // was ugly and confusing.
  if (!item) return null;
  // (legacy empty-state body kept commented for reference)
  if (false) {
    return (
      <div className="card" style={{ display: "none" }}>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
          ↓ {t("Passe en « available » ci-dessous pour recevoir des appels")}
        </div>
      </div>
    );
  }

  // Generic (no-leads-table) fallback shape is preserved below. When the
  // patient-context endpoint returns a non-null context we render enriched
  // collapsible sections on top of it.
  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      {/* Identité & contact (always visible) */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>
          {ctx?.identity.nom || item.display_name || t("Patient")}
        </h3>
        <span className="kbd" style={{ fontSize: 12 }}>{item.e164 ?? "—"}</span>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {(ctx?.history.call_count ?? item.call_count)} {t("appels")}
        {item.scheduled_for ? ` · ${t("Rappeler le")} ${formatDateTime(item.scheduled_for)}` : ""}
        {ctx?.identity.email ? ` · ${ctx.identity.email}` : ""}
        {ctx?.identity.dob ? ` · ${t("DDN")} ${ctx.identity.dob}` : ""}
      </div>

      {/* ── Clinique (open by default) ───────────────────────────────── */}
      {ctx && hasClinical(ctx) && (
        <details open style={sectionStyle()}>
          <summary style={summaryStyle()}>{t("Clinique")}</summary>
          <ClinicalSection ctx={ctx} />
        </details>
      )}

      {/* ── NHS S2 ───────────────────────────────────────────────────── */}
      {ctx && hasNhs(ctx) && (
        <details style={sectionStyle()}>
          <summary style={summaryStyle()}>{t("NHS S2")}</summary>
          <NhsSection ctx={ctx} />
        </details>
      )}

      {/* ── Historique (open by default) ─────────────────────────────── */}
      <details open style={sectionStyle()}>
        <summary style={summaryStyle()}>{t("Historique")}</summary>
        <HistorySection item={item} ctx={ctx} />
      </details>

      {/* ── Transcript du dernier appel IA ───────────────────────────── */}
      {item.original_call_id && (
        <details style={sectionStyle()}>
          <summary style={summaryStyle()}>{t("Transcript appel IA")}</summary>
          <TranscriptSection callId={item.original_call_id} />
        </details>
      )}

      {/* ── Notes (call_1/2/3 + free) ────────────────────────────────── */}
      {(ctx && hasNotes(ctx)) || item.last_note || item.original_call_summary ? (
        <details style={sectionStyle()}>
          <summary style={summaryStyle()}>{t("Notes")}</summary>
          <NotesSection item={item} ctx={ctx} />
        </details>
      ) : null}

      {/* ── Notes agent (éditables) ─────────────────────────────────── */}
      {item.kind === "task" && (
        <details open style={sectionStyle()}>
          <summary style={summaryStyle()}>{t("Mes notes")}</summary>
          <AgentNotesEditor taskId={item.id} initial={item.last_note ?? ""} />
        </details>
      )}

      {/* ── Source (footer) ──────────────────────────────────────────── */}
      {ctx && (ctx.source.source_lead || ctx.source.form_facebook) && (
        <details style={sectionStyle()}>
          <summary style={summaryStyle()}>{t("Source")}</summary>
          <div className="muted" style={{ fontSize: 12, paddingTop: 6 }}>
            {ctx.source.source_lead && (
              <div>
                {t("Source lead")}: {ctx.source.source_lead}
              </div>
            )}
            {ctx.source.form_facebook && (
              <div>
                {t("Formulaire Facebook")}: {ctx.source.form_facebook}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Section helpers (purely presentational, share Axon CSS vars) ────────

function sectionStyle(): React.CSSProperties {
  return {
    borderTop: "1px solid var(--border)",
    paddingTop: 8,
  };
}
function summaryStyle(): React.CSSProperties {
  return {
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    listStyle: "revert",
  };
}

function hasClinical(c: PatientContext): boolean {
  const x = c.clinical;
  return Boolean(
    x.bmi !== null ||
      x.poids !== null ||
      x.taille !== null ||
      x.allergies ||
      x.anesthesia_allergies ||
      x.current_medications ||
      x.past_surgeries ||
      x.other_chronic_conditions,
  );
}
function hasNhs(c: PatientContext): boolean {
  const x = c.nhs;
  return Boolean(
    x.wmp_status ||
      x.wmp_details ||
      x.document_status ||
      x.received_documents ||
      x.missing_documents,
  );
}
function hasNotes(c: PatientContext): boolean {
  const x = c.notes;
  return Boolean(x.call_1 || x.call_2 || x.call_3 || x.free);
}

function ClinicalSection({ ctx }: { ctx: PatientContext }) {
  const t = useT();
  const c = ctx.clinical;
  return (
    <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
      {c.bmi !== null && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: bmiColor(c.bmi),
              lineHeight: 1,
            }}
          >
            {c.bmi}
          </span>
          <span className="muted" style={{ fontSize: 11 }}>
            {t("BMI")}
            {c.poids !== null ? ` · ${c.poids} kg` : ""}
            {c.taille !== null ? ` · ${c.taille} cm` : ""}
          </span>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
        }}
      >
        <Field label={t("Allergies")} value={c.allergies} />
        <Field label={t("Allergies anesthésie")} value={c.anesthesia_allergies} />
        <Field label={t("Traitements en cours")} value={c.current_medications} />
        <Field label={t("Antécédents chirurgicaux")} value={c.past_surgeries} />
        <Field
          label={t("Autres antécédents")}
          value={c.other_chronic_conditions}
          full
        />
      </div>
    </div>
  );
}

function NhsSection({ ctx }: { ctx: PatientContext }) {
  const t = useT();
  const n = ctx.nhs;
  const received = splitDocList(n.received_documents);
  const missing = splitDocList(n.missing_documents);
  return (
    <div style={{ display: "grid", gap: 8, paddingTop: 8, fontSize: 13 }}>
      {n.wmp_status && (
        <div>
          <span className="muted" style={{ fontSize: 11 }}>
            {t("Statut WMP")}:
          </span>{" "}
          <span className="tag" style={{ fontSize: 11 }}>
            {n.wmp_status}
          </span>
        </div>
      )}
      {n.wmp_details && <div style={{ fontStyle: "italic" }}>{n.wmp_details}</div>}
      {n.document_status && (
        <div>
          <span className="muted" style={{ fontSize: 11 }}>
            {t("Dossier")}:
          </span>{" "}
          {n.document_status}
        </div>
      )}
      {received.length > 0 && (
        <div>
          <div className="muted" style={{ fontSize: 11 }}>
            {t("Documents reçus")}
          </div>
          <ul style={{ margin: "2px 0 0 16px", padding: 0, fontSize: 12 }}>
            {received.map((d, i) => (
              <li key={`r-${i}`}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {missing.length > 0 && (
        <div>
          <div className="muted" style={{ fontSize: 11 }}>
            {t("Documents manquants")}
          </div>
          <ul style={{ margin: "2px 0 0 16px", padding: 0, fontSize: 12 }}>
            {missing.map((d, i) => (
              <li key={`m-${i}`}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function HistorySection({ item, ctx }: { item: DeskItem; ctx: PatientContext | null }) {
  const t = useT();
  const qualification = ctx?.history.qualification ?? item.qualification;
  const callCount = ctx?.history.call_count ?? item.call_count;
  const lastCall = ctx?.history.last_call ?? null;
  const lastResponse = ctx?.history.last_response ?? null;
  const cycleStatus = ctx?.history.cycle_status ?? null;
  const currentPhase = ctx?.history.current_phase ?? null;
  return (
    <div style={{ display: "grid", gap: 6, paddingTop: 8, fontSize: 13 }}>
      {qualification && (
        <div>
          <span className="muted" style={{ fontSize: 11 }}>
            {t("Qualification")}:
          </span>{" "}
          <span className="tag" style={{ fontSize: 11 }}>
            {qualification}
          </span>
        </div>
      )}
      <div className="muted" style={{ fontSize: 12 }}>
        {callCount} {t("appels")}
      </div>
      {lastCall && (
        <div>
          <span className="muted" style={{ fontSize: 11 }}>
            {t("Dernier appel")}:
          </span>{" "}
          {formatDateTime(lastCall)}
        </div>
      )}
      {lastResponse && (
        <div>
          <span className="muted" style={{ fontSize: 11 }}>
            {t("Dernière réponse")}:
          </span>{" "}
          {formatDateTime(lastResponse)}
        </div>
      )}
      {(cycleStatus || currentPhase) && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {cycleStatus && (
            <>
              <span className="muted" style={{ fontSize: 11 }}>
                {t("Cycle")}:
              </span>
              <span className="tag" style={{ fontSize: 11 }}>
                {cycleStatus}
              </span>
            </>
          )}
          {currentPhase && (
            <>
              <span className="muted" style={{ fontSize: 11 }}>
                {t("Phase")}:
              </span>
              <span className="tag" style={{ fontSize: 11 }}>
                {currentPhase}
              </span>
            </>
          )}
        </div>
      )}
      {item.transfer_reason && (
        <div>
          <div className="muted" style={{ fontSize: 11 }}>
            {t("Raison du transfert")}
          </div>
          <div>{item.transfer_reason}</div>
        </div>
      )}
    </div>
  );
}

function NotesSection({ item, ctx }: { item: DeskItem; ctx: PatientContext | null }) {
  const t = useT();
  // Timeline-style: each call_n_note becomes a step. We render in order so
  // the agent reads top-to-bottom (call 1 → call 3).
  const steps: Array<{ label: string; text: string }> = [];
  if (ctx?.notes.call_1) steps.push({ label: t("Appel 1"), text: ctx.notes.call_1 });
  if (ctx?.notes.call_2) steps.push({ label: t("Appel 2"), text: ctx.notes.call_2 });
  if (ctx?.notes.call_3) steps.push({ label: t("Appel 3"), text: ctx.notes.call_3 });
  if (ctx?.notes.free) steps.push({ label: t("Note libre"), text: ctx.notes.free });
  // Fallbacks from the generic queue row (works without a leads table).
  if (steps.length === 0 && item.last_note) {
    steps.push({ label: t("Notes récentes"), text: item.last_note });
  }
  return (
    <div style={{ display: "grid", gap: 6, paddingTop: 8 }}>
      {item.original_call_summary && (
        <div style={{ fontSize: 13 }}>
          <div className="muted" style={{ fontSize: 11 }}>
            {t("Résumé de l'appel IA")}
          </div>
          <div style={{ fontStyle: "italic" }}>{item.original_call_summary}</div>
        </div>
      )}
      {steps.map((s, i) => (
        <div
          key={`step-${i}`}
          style={{
            borderLeft: "2px solid var(--border)",
            paddingLeft: 8,
            fontSize: 13,
          }}
        >
          <div className="muted" style={{ fontSize: 11 }}>{s.label}</div>
          <div style={{ fontStyle: "italic" }}>{s.text}</div>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  full,
}: {
  label: string;
  value: string | null;
  full?: boolean;
}) {
  if (!value) return null;
  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 13 }}>{value}</div>
    </div>
  );
}

function splitDocList(s: string | null): string[] {
  if (!s) return [];
  // OCC prod stores docs as comma- or newline-separated free text. Split
  // on either, trim, drop empties.
  return s
    .split(/[,\n;]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function bmiColor(bmi: number): string {
  // Healthy: <25, overweight: 25-29, obese ≥30 (UK NHS thresholds).
  if (bmi >= 30) return "var(--bad, #c53030)";
  if (bmi >= 25) return "var(--warn, #b7791f)";
  return "var(--good, #2f855a)";
}

function DispositionForm({
  item,
  onSaved,
}: {
  item: DeskItem;
  onSaved: () => void;
}) {
  const t = useT();
  const [qualification, setQualification] = useState("");
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [rescheduleTomorrow, setRescheduleTomorrow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Reset form when the focused row changes.
  useEffect(() => {
    setQualification("");
    setNote("");
    setCallbackAt("");
    setRescheduleTomorrow(false);
    setErr(null);
    setOk(null);
  }, [item.id, item.kind]);

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      if (item.kind === "task") {
        const r = await fetch(`/api/desk/tasks/${item.id}/complete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            outcome_disposition: qualification || undefined,
            notes: note || undefined,
            next_callback_at: rescheduleTomorrow
              ? "next_business_day"
              : callbackAt || undefined,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      } else {
        // Legacy path — preserve the previous disposition behavior.
        const r = await fetch("/api/desk/disposition", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            call_id: item.id,
            disposition: qualification || undefined,
            qualification: qualification || undefined,
            note: note || undefined,
            next_callback_at: callbackAt || undefined,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      setOk(t("Enregistré."));
      setNote("");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <h3 style={{ margin: 0 }}>{t("Disposition")}</h3>
      <div className="form-row" style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>
          {t("Qualification")}
        </label>
        <select
          value={qualification}
          onChange={(e) => setQualification(e.target.value)}
        >
          <option value="">— —</option>
          {QUALIFICATIONS.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("Note")}</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder=""
        />
      </div>
      {item.kind === "task" && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={rescheduleTomorrow}
            onChange={(e) => setRescheduleTomorrow(e.target.checked)}
          />
          {t("Reprogrammer demain (prochain jour ouvré)")}
        </label>
      )}
      {!rescheduleTomorrow && (
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            {t("Rappeler le")}
          </label>
          <input
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
          />
        </div>
      )}
      {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
      {ok && <div className="muted" style={{ fontSize: 13 }}>{ok}</div>}
      <div>
        <button onClick={save} disabled={busy}>
          {busy
            ? t("Enregistrement…")
            : rescheduleTomorrow
              ? t("Reprogrammer")
              : t("Marquer terminé")}
        </button>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  return d.toLocaleString();
}
