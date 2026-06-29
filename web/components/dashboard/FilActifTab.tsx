"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import type { GlobalFilters } from "@/lib/global-filters";

// Fil Actif — Live priority board for managers.
//
// Shows two real-time counters refreshed every 10 seconds:
//   1. Unique leads marked "À passer à l'humain" (transfer to human agent)
//   2. Unique leads marked "Pas intéressé" (not interested / declined)
//
// "Unique" means distinct phone numbers — a lead called 3 times counts once.
// Below the counters: an actionable table listing every "passer_humain" lead
// (deduplicated, most recent call first) so managers can act immediately.

const POLL_MS = 10_000;

interface DrillCall {
  id: string;
  started_at: string | null;
  to_e164: string | null;
  summary: string | null;
  agent_handles: { display_name: string | null } | null;
  contacts: { display_name: string | null } | null;
  lead_name?: string | null;
}

interface DrillResponse {
  rows: DrillCall[];
  total?: number;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

/** Keep only the most-recent call per phone number (deduplicates multi-attempt leads). */
function dedupeByPhone(rows: DrillCall[]): DrillCall[] {
  const seen = new Map<string, DrillCall>();
  for (const r of rows) {
    const key = r.to_e164 ?? r.id;
    const existing = seen.get(key);
    if (!existing || (r.started_at ?? "") > (existing.started_at ?? "")) {
      seen.set(key, r);
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""),
  );
}

function BigCounter({
  count,
  label,
  sub,
  color,
  icon,
  urgent,
}: {
  count: number | null;
  label: string;
  sub: string;
  color: string;
  icon: string;
  urgent?: boolean;
}) {
  return (
    <div
      className="card"
      style={{
        flex: 1,
        minWidth: 220,
        padding: 28,
        borderLeft: `4px solid ${color}`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {urgent && (count ?? 0) > 0 && (
        <span
          style={{
            position: "absolute",
            top: 10,
            right: 12,
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color,
            background: `color-mix(in srgb, ${color} 15%, transparent)`,
            padding: "2px 8px",
            borderRadius: 99,
          }}
        >
          Action requise
        </span>
      )}
      <div style={{ fontSize: 16, marginBottom: 8 }}>{icon}</div>
      <div
        style={{
          fontSize: 52,
          fontWeight: 800,
          color: count === null ? "var(--muted)" : color,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count === null ? "—" : count}
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 8 }}>{label}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{sub}</div>
    </div>
  );
}

export function FilActifTab({
  leadsSource = "prod",
  system = "all",
  global: _g = {} as GlobalFilters,
}: {
  leadsSource?: "prod" | "test";
  system?: "all" | "retell" | "axon";
  global?: GlobalFilters;
}) {
  const t = useT();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [uniquePasserHumain, setUniquePasserHumain] = useState<number | null>(null);
  const [uniquePasInteresse, setUniquePasInteresse] = useState<number | null>(null);
  const [actionRows, setActionRows] = useState<DrillCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<Date | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const baseQs = new URLSearchParams({
      from: todayIso,
      to: todayIso,
      leads_source: leadsSource,
      limit: "200",
      ...(system !== "all" ? { system } : {}),
    });

    try {
      // Fetch both qualification lists in parallel
      const [phRes, piRes] = await Promise.all([
        fetch(`/api/dashboard/calls-drill?${baseQs}&qualification=passer_humain`, {
          cache: "no-store",
        }),
        fetch(`/api/dashboard/calls-drill?${baseQs}&qualification=pas_interesse`, {
          cache: "no-store",
        }),
      ]);

      if (!mounted.current) return;

      // passer_humain
      let phRows: DrillCall[] = [];
      if (phRes.ok) {
        const j = (await phRes.json()) as DrillResponse | DrillCall[];
        phRows = Array.isArray(j) ? j : (j?.rows ?? []);
      }
      const phDeduped = dedupeByPhone(phRows);

      // pas_interesse
      let piRows: DrillCall[] = [];
      if (piRes.ok) {
        const j = (await piRes.json()) as DrillResponse | DrillCall[];
        piRows = Array.isArray(j) ? j : (j?.rows ?? []);
      }
      const uniquePiPhones = new Set(piRows.map((r) => r.to_e164 ?? r.id));

      setUniquePasserHumain(phDeduped.length);
      setUniquePasInteresse(uniquePiPhones.size);
      setActionRows(phDeduped);
      setError(null);
      setLastAt(new Date());
      if (loading) setLoading(false);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Erreur réseau");
    }
  }, [todayIso, leadsSource, system, loading]);

  useEffect(() => {
    mounted.current = true;
    load();
    const poll = setInterval(load, POLL_MS);
    return () => {
      mounted.current = false;
      clearInterval(poll);
    };
  }, [load]);

  const heartbeat = lastAt
    ? lastAt.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <>
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span style={{ fontWeight: 700, fontSize: 16 }}>⏵ {t("Fil Actif")}</span>
          <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
            {t("Aujourd'hui")} · {t("Mise à jour automatique")} ·{" "}
            <span style={{ color: lastAt ? "var(--good)" : "var(--muted)" }}>●</span>{" "}
            {heartbeat}
          </span>
        </div>
        <button
          className="ghost"
          onClick={load}
          style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px" }}
        >
          {t("Actualiser")}
        </button>
      </div>

      {error && (
        <div
          className="card"
          style={{
            borderColor: "var(--bad)",
            color: "var(--bad)",
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* ── Two live counters ── */}
      <div
        style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 28 }}
      >
        <BigCounter
          count={loading ? null : uniquePasserHumain}
          label={t("À passer à l'humain")}
          sub={t("Leads uniques demandant un agent humain")}
          color="var(--bad)"
          icon="🔴"
          urgent
        />
        <BigCounter
          count={loading ? null : uniquePasInteresse}
          label={t("Pas intéressés")}
          sub={t("Leads uniques ayant décliné aujourd'hui")}
          color="var(--warn)"
          icon="📵"
        />
      </div>

      {/* ── Action list: passer_humain leads ── */}
      <div
        style={{
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          🔴 {t("Leads à transférer à un humain")}
        </h3>
        <span className="muted" style={{ fontSize: 12 }}>
          — {actionRows.length} {t("lead(s) uniques aujourd'hui")}
        </span>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 28, textAlign: "center" }}>
          <p className="muted" style={{ margin: 0 }}>{t("Chargement…")}</p>
        </div>
      ) : actionRows.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>✅</div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {t("Aucun transfert humain en attente pour le moment.")}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th>{t("Heure")}</th>
                <th>{t("Contact")}</th>
                <th>{t("Numéro")}</th>
                <th>{t("Agent IA")}</th>
                <th>{t("Résumé")}</th>
              </tr>
            </thead>
            <tbody>
              {actionRows.map((row) => {
                const name =
                  row.lead_name ||
                  row.contacts?.display_name ||
                  row.to_e164 ||
                  "—";
                const agent = row.agent_handles?.display_name ?? "—";
                const summary = row.summary
                  ? row.summary.slice(0, 90) +
                    (row.summary.length > 90 ? "…" : "")
                  : "—";
                return (
                  <tr key={row.id}>
                    <td
                      className="muted"
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {fmtDate(row.started_at)} {fmtTime(row.started_at)}
                    </td>
                    <td style={{ fontWeight: 600 }}>{name}</td>
                    <td
                      className="muted"
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 12,
                      }}
                    >
                      {row.to_e164 ?? "—"}
                    </td>
                    <td className="muted">{agent} 🤖</td>
                    <td
                      className="muted"
                      style={{
                        maxWidth: 280,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {summary}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: 14, fontSize: 11 }}>
        {t(
          "Mise à jour automatique toutes les 10 secondes. Données du jour uniquement.",
        )}
      </p>
    </>
  );
}
