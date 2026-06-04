"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Softphone } from "@/components/voice/Softphone";
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
    return [
      ...tasks.shared.map(taskToItem),
      ...legacy.shared.map(legacyToItem),
    ];
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
        <button
          className={mobileView === "shared" ? "" : "ghost"}
          onClick={() => setMobileView("shared")}
        >
          {t("File équipe")} ({sharedCount})
        </button>
      </div>

      {actionErr && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <div style={{ color: "var(--bad)", fontSize: 13 }}>{actionErr}</div>
        </div>
      )}

      <div className="desk-3pane">
        {/* LEFT — personal queue ("Appels du jour") */}
        <aside
          className="card desk-pane"
          data-pane="personal"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
          }}
        >
          <h3 style={{ margin: 0 }}>
            {t("Appels du jour")} ({personalCount + doneCount})
          </h3>
          <div className="muted" style={{ fontSize: 12 }}>
            {t("À traiter")} ({personalCount})
          </div>
          {loading && personal.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>{t("Chargement…")}</div>
          ) : personal.length === 0 ? (
            <div
              style={{
                padding: "14px 8px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontSize: 24, opacity: 0.5, marginBottom: 6 }}>📋</div>
              <div>{t("Aucun appel à traiter")}</div>
              <div style={{ marginTop: 4 }}>
                {t("Prends-en un dans le Pool partagé →")}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {personal.map((c) => (
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
            </div>
          )}

          {/* Faits aujourd'hui — collapsible */}
          {doneCount > 0 && (
            <div style={{ marginTop: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <button
                className="ghost"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                  fontSize: 12,
                }}
                onClick={() => setDoneOpen((v) => !v)}
                aria-expanded={doneOpen}
              >
                <span>
                  {t("Faits aujourd'hui")} ({doneCount})
                </span>
                <span aria-hidden style={{ opacity: 0.7 }}>
                  {doneOpen ? "▾" : "▸"}
                </span>
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

        {/* CENTER — patient context + softphone + disposition */}
        <section
          className="desk-pane desk-center"
          style={{ display: "grid", gap: 12 }}
        >
          <PatientCard item={focusedItem} />
          {/* Softphone stays the source of truth for the dial / hangup. */}
          <Softphone />
          {focusedItem && (
            <DispositionForm
              item={focusedItem}
              onSaved={() => {
                setFocused(null);
                void refresh();
              }}
            />
          )}
        </section>

        {/* RIGHT — shared pool */}
        <aside
          className="card desk-pane"
          data-pane="shared"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
          }}
        >
          <h3 style={{ margin: 0 }}>
            {t("Pool partagé")} ({sharedCount})
          </h3>
          <div className="muted" style={{ fontSize: 12 }}>
            {t("File équipe")}
          </div>
          {loading && shared.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>{t("Chargement…")}</div>
          ) : shared.length === 0 ? (
            <div
              style={{
                padding: "14px 8px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontSize: 24, opacity: 0.5, marginBottom: 6 }}>✓</div>
              <div>{t("Pool partagé vide")}</div>
              <div style={{ marginTop: 4 }}>{t("Tous les patients sont traités.")}</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {shared.map((c) => (
                <QueueRow
                  key={`${c.kind}:${c.id}`}
                  item={c}
                  active={focused?.kind === c.kind && focused?.id === c.id}
                  onClick={() => setFocused({ kind: c.kind, id: c.id })}
                  trailing={
                    <button
                      style={{ padding: "4px 10px", fontSize: 11 }}
                      disabled={claimBusy === c.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void claim(c);
                      }}
                    >
                      {claimBusy === c.id ? "…" : t("Prendre")}
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* Inline CSS that toggles 3-pane → single-pane on narrow viewports. */}
      <style jsx>{`
        .desk-3pane {
          display: grid;
          grid-template-columns: 240px 1fr 260px;
          gap: 14px;
        }
        @media (max-width: 1100px) {
          .desk-3pane {
            grid-template-columns: 200px 1fr 220px;
          }
        }
        @media (max-width: 900px) {
          .desk-3pane {
            grid-template-columns: 1fr;
          }
          :global(.desk-mobile-toggle) {
            display: flex !important;
          }
          .desk-3pane [data-pane="personal"] {
            display: ${mobileView === "personal" ? "flex" : "none"};
          }
          .desk-3pane [data-pane="shared"] {
            display: ${mobileView === "shared" ? "flex" : "none"};
          }
        }
        /* Inside the desk, the Softphone's 3-col internal grid (Appels /
           Keypad / Fiche) competes with the desk's own 3-pane layout and
           crushes everything. Force it to single-column so it lays out
           vertically and breathes. */
        .desk-center :global(.softphone-grid) {
          grid-template-columns: 1fr !important;
        }
        /* The Softphone repeats info (recent calls, contact card) that the
           desk's PatientCard / queue panes already provide. Hide those two
           internal columns to reduce visual noise; keep only the central
           presence + dialer column. */
        .desk-center :global(.softphone-left),
        .desk-center :global(.softphone-right) {
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

  if (!item) {
    return (
      <div
        className="card"
        style={{
          padding: 24,
          minHeight: 220,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 42, opacity: 0.45 }}>☎</div>
        <h3 style={{ margin: 0 }}>{t("Prêt à prendre un appel")}</h3>
        <p className="muted" style={{ margin: 0, fontSize: 13, maxWidth: 360, lineHeight: 1.6 }}>
          {t(
            "Choisis un patient à gauche dans Ma file, ou prends-en un depuis le Pool partagé à droite. Son contexte (historique, qualification, notes) s'affichera ici.",
          )}
        </p>
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

      {/* ── Notes (call_1/2/3 + free) ────────────────────────────────── */}
      {(ctx && hasNotes(ctx)) || item.last_note || item.original_call_summary ? (
        <details style={sectionStyle()}>
          <summary style={summaryStyle()}>{t("Notes")}</summary>
          <NotesSection item={item} ctx={ctx} />
        </details>
      ) : null}

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
