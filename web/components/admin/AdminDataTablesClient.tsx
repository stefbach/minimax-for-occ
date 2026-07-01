"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

export interface OrgOption {
  id: string;
  name: string;
}

interface Assigned {
  id: string;
  physical_table: string;
  note: string | null;
  created_at: string;
}

export function AdminDataTablesClient({ orgs }: { orgs: OrgOption[] }) {
  const t = useT();
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [assigned, setAssigned] = useState<Assigned[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(org: string) {
    if (!org) return;
    setError(null);
    const r = await fetch(`/api/admin/data-tables?org_id=${encodeURIComponent(org)}`);
    if (!r.ok) {
      setError(t("Chargement échoué (réservé aux super-admins)."));
      return;
    }
    const body = await r.json();
    setAssigned(body.assigned ?? []);
    setAvailable((body.available ?? []).map((a: { physical_table: string }) => a.physical_table));
  }

  useEffect(() => {
    if (orgId) load(orgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function assign() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/data-tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId, physical_table: pick, note: note.trim() || null }),
      });
      const body = await r.json();
      if (!r.ok) { setError(body.error ?? t("Échec") + ` (${r.status})`); return; }
      setPick("");
      setNote("");
      await load(orgId);
    } finally {
      setBusy(false);
    }
  }

  async function unassign(id: string) {
    if (!confirm(t("Retirer cette attribution ? (la table physique n'est pas supprimée)"))) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/data-tables?id=${id}`, { method: "DELETE" });
      if (r.ok) await load(orgId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div>
          <label>{t("Client (organisation)")}</label>
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        <div className="form-row">
          <div>
            <label>{t("Table à attribuer")}</label>
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t("— choisir une table physique —")}</option>
              {available.map((tbl) => (
                <option key={tbl} value={tbl}>{tbl}</option>
              ))}
            </select>
            {available.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                {t("Aucune table libre. Importez-en une dans Supabase d'abord.")}
              </div>
            )}
          </div>
          <div>
            <label>{t("Note (optionnel)")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ex: prod / test")} />
          </div>
        </div>
        <div>
          <button onClick={assign} disabled={busy || !pick}>{t("Attribuer à ce client")}</button>
        </div>
        {error && <div style={{ color: "#ff8080" }}>{error}</div>}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="list">
          <thead>
            <tr>
              <th>{t("Table attribuée")}</th>
              <th>{t("Note")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {assigned.length === 0 ? (
              <tr><td colSpan={3} style={{ color: "var(--muted)", padding: 14 }}>{t("Aucune table attribuée à ce client.")}</td></tr>
            ) : (
              assigned.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontFamily: "monospace" }}>{a.physical_table}</td>
                  <td style={{ color: "var(--muted)" }}>{a.note ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="danger" style={{ padding: "5px 9px" }} onClick={() => unassign(a.id)}>{t("Retirer")}</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
