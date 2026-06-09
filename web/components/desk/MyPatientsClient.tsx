"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";

interface PatientRow {
  contact_id: string | null;
  display_name: string | null;
  e164: string | null;
  last_task_id: string;
  last_status: string;
  last_qualification: string | null;
  last_scheduled_for: string;
  last_updated_at: string;
  task_count: number;
}

const PAGE_SIZE = 50;

export function MyPatientsClient() {
  const t = useT();
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [qualification, setQualification] = useState("");
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<"updated" | "name" | "count">("updated");

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(PAGE_SIZE),
      });
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (qualification) params.set("qualification", qualification);
      const r = await fetch(`/api/desk/my-patients?${params.toString()}`, { cache: "no-store" });
      const j = (await r.json()) as { patients?: PatientRow[]; total?: number; error?: string };
      if (!r.ok) {
        setErr(j.error ?? `HTTP ${r.status}`);
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(j.patients ?? []);
      setTotal(j.total ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch_failed");
    } finally {
      setLoading(false);
    }
  }, [q, status, qualification, offset]);

  // Re-fetch when filters or pagination change. Search has its own
  // debounce so we don't hammer the API on every keystroke.
  useEffect(() => {
    const handle = setTimeout(refresh, q ? 250 : 0);
    return () => clearTimeout(handle);
  }, [refresh, q]);

  const sortedRows = useMemo(() => {
    const cloned = [...rows];
    switch (sortBy) {
      case "name":
        cloned.sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""));
        break;
      case "count":
        cloned.sort((a, b) => b.task_count - a.task_count);
        break;
      case "updated":
      default:
        cloned.sort((a, b) => b.last_updated_at.localeCompare(a.last_updated_at));
    }
    return cloned;
  }, [rows, sortBy]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: 12 }}>
        <input
          type="search"
          placeholder={t("Rechercher (nom, téléphone)")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          style={{ flex: "1 1 240px", padding: 8 }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
          style={{ padding: 8 }}
        >
          <option value="">{t("Tous les statuts")}</option>
          <option value="pending">{t("À traiter")}</option>
          <option value="in_progress">{t("En cours")}</option>
          <option value="done">{t("Terminé")}</option>
        </select>
        <input
          type="text"
          placeholder={t("Qualification (filtre)")}
          value={qualification}
          onChange={(e) => {
            setQualification(e.target.value);
            setOffset(0);
          }}
          style={{ padding: 8, width: 180 }}
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "updated" | "name" | "count")}
          style={{ padding: 8 }}
        >
          <option value="updated">{t("Trier: récent")}</option>
          <option value="name">{t("Trier: nom")}</option>
          <option value="count">{t("Trier: nb tâches")}</option>
        </select>
        <button className="ghost" onClick={refresh}>{t("Rafraîchir")}</button>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-2)", textAlign: "left" }}>
                <Th>{t("Patient")}</Th>
                <Th>{t("Téléphone")}</Th>
                <Th>{t("Qualification")}</Th>
                <Th>{t("Statut")}</Th>
                <Th>{t("Dernière MAJ")}</Th>
                <Th>{t("Tâches")}</Th>
                <Th>{t("Actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="muted" style={{ padding: 16, textAlign: "center" }}>
                    {t("Chargement…")}
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted" style={{ padding: 16, textAlign: "center" }}>
                    {t("Aucun patient ne correspond à cette recherche.")}
                  </td>
                </tr>
              ) : (
                sortedRows.map((p) => (
                  <tr key={p.last_task_id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>{p.display_name || "—"}</Td>
                    <Td>{p.e164 || "—"}</Td>
                    <Td>
                      {p.last_qualification ? (
                        <span className="tag" style={{ fontSize: 11 }}>{p.last_qualification}</span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      <span className="tag" style={{ fontSize: 11 }}>{p.last_status}</span>
                    </Td>
                    <Td>{formatDateTime(p.last_updated_at)}</Td>
                    <Td style={{ textAlign: "right" }}>{p.task_count}</Td>
                    <Td>
                      <Link
                        href={`/desk?task=${encodeURIComponent(p.last_task_id)}`}
                        className="ghost"
                        style={{ padding: "4px 10px", fontSize: 11, textDecoration: "none" }}
                      >
                        {t("Ouvrir")}
                      </Link>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center" }}>
        <div className="muted" style={{ fontSize: 12 }}>
          {t("Total")}: {total} · {t("Page")}: {Math.floor(offset / PAGE_SIZE) + 1} /{" "}
          {Math.max(1, Math.ceil(total / PAGE_SIZE))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="ghost"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            ← {t("Précédent")}
          </button>
          <button
            className="ghost"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            {t("Suivant")} →
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textTransform: "uppercase",
        fontSize: 11,
        letterSpacing: 0.4,
        color: "var(--muted)",
        padding: "10px 12px",
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "10px 12px", verticalAlign: "middle", ...style }}>{children}</td>;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
