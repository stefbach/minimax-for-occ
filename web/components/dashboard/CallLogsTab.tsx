"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

// Call Logs tab — generic Axon call history (no OCC qualification logic).
// Consumes the existing org-scoped /api/calls route.

interface CallRow {
  id: string;
  direction: "inbound" | "outbound" | string;
  state: string;
  from_e164: string | null;
  to_e164: string | null;
  started_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  agent_handles: { display_name: string | null } | null;
  contacts: { display_name: string | null } | null;
}

const STATE_FILTERS: { id: string; label: string }[] = [
  { id: "ended,failed", label: "Terminés" },
  { id: "ended", label: "Réussis" },
  { id: "failed", label: "Échecs" },
  { id: "ringing,ivr,in_progress,wrap_up", label: "En cours" },
];

function fmtDuration(secs: number | null): string {
  if (!secs || secs < 0) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
function counterparty(c: CallRow): string {
  const num = c.direction === "inbound" ? c.from_e164 : c.to_e164;
  return c.contacts?.display_name || num || "—";
}

export function CallLogsTab() {
  const t = useT();
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string>("ended,failed");
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"all" | "inbound" | "outbound">("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/calls?state=${encodeURIComponent(stateFilter)}&limit=250`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRows(Array.isArray(j) ? j : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch error");
    } finally {
      setLoading(false);
    }
  }, [stateFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (direction !== "all" && c.direction !== direction) return false;
      if (!q) return true;
      const haystack = `${counterparty(c)} ${c.from_e164 ?? ""} ${c.to_e164 ?? ""} ${c.agent_handles?.display_name ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, direction]);

  return (
    <>
      <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12 }}>
        <div>
          <label>{t("État")}</label>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            {STATE_FILTERS.map((s) => (
              <option key={s.id} value={s.id}>{t(s.label)}</option>
            ))}
          </select>
        </div>
        <div>
          <label>{t("Sens")}</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
            <option value="all">{t("Tous")}</option>
            <option value="inbound">{t("↘ Entrants")}</option>
            <option value="outbound">{t("↗ Sortants")}</option>
          </select>
        </div>
        <div>
          <label>{t("Rechercher")}</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Nom, numéro, agent…")}
          />
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="list" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th>{t("Date")}</th>
              <th>{t("Contact")}</th>
              <th>{t("Sens")}</th>
              <th>{t("Agent")}</th>
              <th>{t("Durée")}</th>
              <th>{t("État")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="muted" style={{ padding: 16, textAlign: "center" }}>{t("Chargement…")}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="muted" style={{ padding: 16, textAlign: "center" }}>
                {t("Aucun appel ne correspond aux filtres.")}
              </td></tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(c.started_at)}</td>
                  <td>{counterparty(c)}</td>
                  <td>{c.direction === "inbound" ? "↘" : "↗"}</td>
                  <td className="muted">{c.agent_handles?.display_name ?? "—"}</td>
                  <td>{fmtDuration(c.duration_secs)}</td>
                  <td>
                    <span className={`tag${c.state === "failed" ? "" : " accent"}`} style={c.state === "failed" ? { color: "var(--bad)" } : undefined}>
                      {c.disposition || t(c.state)}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link href={`/calls/${c.id}`}>{t("Voir")}</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {filtered.length} · {t("Appels")} (max 250).
      </div>
    </>
  );
}
