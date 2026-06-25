"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ErrorsAlertsResponse } from "@/app/api/dashboard/errors-alerts/route";
import { useT } from "@/lib/i18n";

// "Erreurs & Alertes" — surfaces system errors and call-quality anomalies for
// the active org. All data comes from /api/dashboard/errors-alerts (org-scoped).

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mi = d.getMinutes().toString().padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

function fmtFull(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("fr-FR");
}

export function ErrorsAlertsTab({ campaignId }: { campaignId?: string }) {
  const t = useT();
  const [data, setData] = useState<ErrorsAlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string>("all");
  const [errorFrom, setErrorFrom] = useState<string>("");
  const [recalling, setRecalling] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (errorType !== "all") qs.set("error_type", errorType);
      if (errorFrom) qs.set("from", errorFrom);
      if (campaignId && campaignId !== "all") qs.set("campaign_id", campaignId);
      const r = await fetch(`/api/dashboard/errors-alerts?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch error");
    } finally {
      setLoading(false);
    }
  }, [errorType, errorFrom, campaignId]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const markRecalled = async (callId: string) => {
    setRecalling(callId);
    try {
      const r = await fetch("/api/dashboard/errors-alerts/mark-recalled", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ call_id: callId }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "mark-recalled error");
    } finally {
      setRecalling(null);
    }
  };

  const allTypes = useMemo(() => data?.error_types ?? [], [data]);

  if (loading && !data)
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>{t("Chargement…")}</p>
      </div>
    );
  if (error && !data)
    return (
      <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>
        {error}
      </div>
    );
  if (!data) return null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="page-header" style={{ margin: 0 }}>
        <div>
          <h2 style={{ margin: 0 }}>{t("Erreurs & Alertes")}</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            {t("Vue consolidée des erreurs système et des appels à retraiter")}
          </div>
        </div>
        <button onClick={fetchData} className="ghost" style={{ padding: "5px 12px", fontSize: 13 }}>
          ↻ {t("Actualiser")}
        </button>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>
          {error}
        </div>
      )}

      {/* 1. Log des erreurs système */}
      <section>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          ⚠ {t("Log des erreurs système")}
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select
              value={errorType}
              onChange={(e) => setErrorType(e.target.value)}
              style={{
                background: "var(--bg-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                padding: "5px 10px",
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <option value="all">{t("Tous les types")}</option>
              {allTypes.map((typ) => (
                <option key={typ} value={typ}>
                  {typ}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={errorFrom}
              onChange={(e) => setErrorFrom(e.target.value)}
              style={{
                background: "var(--bg-2)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                padding: "5px 10px",
                borderRadius: 6,
                fontSize: 13,
              }}
            />
            {errorFrom && (
              <button className="ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setErrorFrom("")}>
                ✕
              </button>
            )}
          </div>
          {data.errors.length === 0 ? (
            <p className="muted" style={{ margin: 0, padding: "12px 4px" }}>
              {t("Aucune erreur enregistrée. 👍")}
            </p>
          ) : (
            <table className="list" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>{t("Date")}</th>
                  <th>{t("Type")}</th>
                  <th>{t("Message")}</th>
                </tr>
              </thead>
              <tbody>
                {data.errors.map((e) => (
                  <tr key={e.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtFull(e.occurred_at)}</td>
                    <td>
                      <span className="tag">{e.error_type}</span>
                    </td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* 2. Répondeurs à rappeler */}
      <section>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          ☎ {t("Répondeurs à rappeler")} · <strong style={{ color: "var(--text)" }}>{data.callbacks_count}</strong>
        </div>
        <div className="card" style={{ padding: 12 }}>
          {data.callbacks.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{t("Aucun rappel en attente.")}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {data.callbacks.map((c) => (
                <li
                  key={c.call_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 10,
                    borderRadius: 8,
                    background: "color-mix(in srgb, var(--warn) 8%, var(--panel))",
                    border: "1px solid color-mix(in srgb, var(--warn) 30%, var(--border))",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{c.contact_name || t("Inconnu")}</div>
                    <div className="muted" style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                      {c.e164 ?? "—"}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {(c.duration_secs ?? 0)}s · {t("voicemail confirmé")} · {fmtDateTime(c.ended_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => markRecalled(c.call_id)}
                    disabled={recalling === c.call_id}
                    style={{ padding: "6px 12px", fontSize: 12 }}
                  >
                    {recalling === c.call_id ? t("…") : t("Marquer rappelé")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 3. Robot awareness */}
      <section>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          🤖 {t("Robot awareness")}
        </div>
        <div className="card" style={{ padding: 12 }}>
          {data.robot_awareness.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{t("Aucun appel concerné.")}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {data.robot_awareness.map((c) => (
                <li
                  key={c.call_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 10,
                    borderRadius: 8,
                    background: "color-mix(in srgb, var(--bad) 8%, var(--panel))",
                    border: "1px solid color-mix(in srgb, var(--bad) 30%, var(--border))",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{c.contact_name || t("Inconnu")}</div>
                    <div className="muted" style={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
                      {c.e164 ?? "—"}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--bad)", marginTop: 2 }}>
                      {t("Recommandation : rappel humain prioritaire")}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {fmtDateTime(c.ended_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 4. Anomalies */}
      <section>
        <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          ⚑ {t("Anomalies")}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("Numéro jamais joint")}</div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
              {t("Numéros avec 3+ tentatives sans aucun décroché (30 derniers jours)")}
            </div>
            {data.never_reached.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{t("Aucun numéro concerné.")}</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                {data.never_reached.map((r) => (
                  <li
                    key={r.to_e164}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: "var(--bg-2)",
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      {r.contact_name && <div style={{ fontWeight: 600, fontSize: 13 }}>{r.contact_name}</div>}
                      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: r.contact_name ? "var(--muted)" : undefined }}>{r.to_e164}</span>
                    </span>
                    <span className="tag">
                      {r.attempts} {t("tent.")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("3 tentatives sans contact")}</div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
              {t("Contacts avec 3+ tentatives sans décroché (30 derniers jours)")}
            </div>
            {data.three_attempts.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{t("Aucun contact concerné.")}</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                {data.three_attempts.map((r) => (
                  <li
                    key={r.contact_id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: "var(--bg-2)",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.contact_name || t("Inconnu")}
                      <span className="muted" style={{ marginLeft: 6, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                        {r.e164 ?? ""}
                      </span>
                    </span>
                    <span className="tag">
                      {r.attempts} {t("tent.")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
