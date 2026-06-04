"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Softphone } from "@/components/voice/Softphone";
import { useT } from "@/lib/i18n";

interface DeskCall {
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

interface QueueResponse {
  personal: DeskCall[];
  shared: DeskCall[];
}

const QUALIFICATIONS = [
  "rappel_humain",
  "rappel_planifie",
  "transfert_humain",
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
 *   │ Ma file    │ Patient + Softphone  │ Pool       │
 *   │ (personal) │ + Disposition form   │ partagé    │
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
  const [data, setData] = useState<QueueResponse>({ personal: [], shared: [] });
  const [loading, setLoading] = useState(true);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"personal" | "shared">("personal");
  const [claimBusy, setClaimBusy] = useState<string | null>(null);
  const [releaseBusy, setReleaseBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Pre-load the dial pad whenever a row is focused — synced via the URL so
  // the Softphone (already mounted) picks it up via useSearchParams.
  const focused = useMemo(() => {
    const all = [...data.personal, ...data.shared];
    return all.find((c) => c.id === focusedId) ?? null;
  }, [data, focusedId]);

  useEffect(() => {
    if (!focused?.e164) return;
    const sp = new URLSearchParams(window.location.search);
    sp.set("prefill", focused.e164);
    if (focused.display_name) sp.set("name", focused.display_name);
    else sp.delete("name");
    sp.delete("call"); // never auto-dial from focusing a row
    const url = `${window.location.pathname}?${sp.toString()}`;
    window.history.replaceState(null, "", url);
    // Manually fire a popstate so Softphone's useSearchParams updates.
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [focused?.id, focused?.e164, focused?.display_name]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/desk/queue", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as QueueResponse;
      setData(j);
    } catch {
      /* ignore — best-effort */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function claim(callId: string) {
    setClaimBusy(callId);
    setActionErr(null);
    try {
      const r = await fetch("/api/desk/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ call_id: callId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setFocusedId(callId);
      await refresh();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setClaimBusy(null);
    }
  }

  async function release(callId: string) {
    setReleaseBusy(callId);
    setActionErr(null);
    try {
      const r = await fetch("/api/desk/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ call_id: callId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (focusedId === callId) setFocusedId(null);
      await refresh();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReleaseBusy(null);
    }
  }

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
          {t("Mes appels")} ({data.personal.length})
        </button>
        <button
          className={mobileView === "shared" ? "" : "ghost"}
          onClick={() => setMobileView("shared")}
        >
          {t("File équipe")} ({data.shared.length})
        </button>
      </div>

      {actionErr && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <div style={{ color: "var(--bad)", fontSize: 13 }}>{actionErr}</div>
        </div>
      )}

      <div className="desk-3pane">
        {/* LEFT — personal queue */}
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
            {t("Ma file")} ({data.personal.length})
          </h3>
          <div className="muted" style={{ fontSize: 12 }}>
            {t("Mes appels du jour")}
          </div>
          {loading && data.personal.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>{t("Chargement…")}</div>
          ) : data.personal.length === 0 ? (
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
              {data.personal.map((c) => (
                <QueueRow
                  key={c.id}
                  call={c}
                  active={c.id === focusedId}
                  onClick={() => setFocusedId(c.id)}
                  trailing={
                    <button
                      className="ghost"
                      style={{ padding: "4px 8px", fontSize: 11 }}
                      disabled={releaseBusy === c.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void release(c.id);
                      }}
                    >
                      {releaseBusy === c.id ? "…" : t("Relâcher")}
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </aside>

        {/* CENTER — patient context + softphone + disposition */}
        <section
          className="desk-pane desk-center"
          style={{ display: "grid", gap: 12 }}
        >
          <PatientCard call={focused} />
          {/* The Softphone takes over for the actual dial / hangup / mute. */}
          <Softphone />
          {focused && <DispositionForm callId={focused.id} onSaved={refresh} />}
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
            {t("Pool partagé")} ({data.shared.length})
          </h3>
          <div className="muted" style={{ fontSize: 12 }}>
            {t("File équipe")}
          </div>
          {loading && data.shared.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>{t("Chargement…")}</div>
          ) : data.shared.length === 0 ? (
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
              {data.shared.map((c) => (
                <QueueRow
                  key={c.id}
                  call={c}
                  active={c.id === focusedId}
                  onClick={() => setFocusedId(c.id)}
                  trailing={
                    <button
                      style={{ padding: "4px 10px", fontSize: 11 }}
                      disabled={claimBusy === c.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void claim(c.id);
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

function QueueRow({
  call,
  active,
  onClick,
  trailing,
}: {
  call: DeskCall;
  active: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  const t = useT();
  const title = call.display_name || call.e164 || "—";
  return (
    <button
      className="ghost"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "var(--bg-2)" : "transparent",
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
        {call.e164 ?? "—"}
        {call.call_count > 1 ? ` · ${call.call_count} ${t("appels")}` : ""}
      </div>
      {call.qualification && (
        <span className="tag" style={{ fontSize: 10, alignSelf: "flex-start" }}>
          {call.qualification}
        </span>
      )}
      {call.last_note && (
        <div className="muted" style={{ fontSize: 11, fontStyle: "italic" }}>
          “{truncate(call.last_note, 60)}”
        </div>
      )}
      {call.human_callback_at && (
        <div className="muted" style={{ fontSize: 11 }}>
          {t("Rappeler le")} {formatDateTime(call.human_callback_at)}
        </div>
      )}
    </button>
  );
}

function PatientCard({ call }: { call: DeskCall | null }) {
  const t = useT();
  if (!call) {
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
  return (
    <div className="card" style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h3 style={{ margin: 0 }}>{call.display_name ?? t("Patient")}</h3>
        <span className="kbd" style={{ fontSize: 12 }}>{call.e164 ?? "—"}</span>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {t("Dernier appel")}: {formatDateTime(call.last_call_at)} ·{" "}
        {call.call_count} {t("appels")}
      </div>
      {call.qualification && (
        <div>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("Qualification")}:
          </span>{" "}
          <span className="tag" style={{ fontSize: 11 }}>
            {call.qualification}
          </span>
        </div>
      )}
      {call.last_note && (
        <div style={{ fontSize: 13 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {t("Notes récentes")}:
          </div>
          <div style={{ fontStyle: "italic" }}>{call.last_note}</div>
        </div>
      )}
    </div>
  );
}

function DispositionForm({
  callId,
  onSaved,
}: {
  callId: string;
  onSaved: () => void;
}) {
  const t = useT();
  const [qualification, setQualification] = useState("");
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Reset form when the focused call changes.
  useEffect(() => {
    setQualification("");
    setNote("");
    setCallbackAt("");
    setErr(null);
    setOk(null);
  }, [callId]);

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const r = await fetch("/api/desk/disposition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          call_id: callId,
          disposition: qualification || undefined,
          qualification: qualification || undefined,
          note: note || undefined,
          next_callback_at: callbackAt || undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
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
      {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
      {ok && <div className="muted" style={{ fontSize: 13 }}>{ok}</div>}
      <div>
        <button onClick={save} disabled={busy}>
          {busy ? t("Enregistrement…") : t("Sauvegarder")}
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
