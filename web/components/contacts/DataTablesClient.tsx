"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { CreateDataTableModal } from "./CreateDataTableModal";
import { ConnectTableModal } from "./ConnectTableModal";

export interface DataTableRow {
  id: string;
  physical_table: string;
  label: string;
  columns: Array<{ key: string; label: string; type: string }>;
  phone_column: string;
  name_column: string | null;
  is_managed: boolean;
  created_at: string;
  row_count: number;
}

export function DataTablesClient({ initialTables }: { initialTables: DataTableRow[] }) {
  const t = useT();
  const router = useRouter();
  const [tables] = useState<DataTableRow[]>(initialTables);
  const [showCreate, setShowCreate] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  function onDone(registryId: string) {
    setShowCreate(false);
    setShowConnect(false);
    router.push(`/contacts/${registryId}`);
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => setShowCreate(true)}>{t("+ Créer une table")}</button>
        <button className="ghost" onClick={() => setShowConnect(true)}>
          🔌 {t("Connecter une table existante")}
        </button>
      </div>

      {tables.length === 0 ? (
        <div className="card">
          <h3>{t("Aucune table de contacts")}</h3>
          <p className="muted">
            {t("Une « table » contient les contacts à appeler, avec vos propres colonnes (téléphone, nom, IMC, qualification…). Vous pouvez :")}
          </p>
          <ul className="muted" style={{ marginTop: 0 }}>
            <li><strong>{t("Créer une table")}</strong> {t("directement ici (ex : leads_rdv_test_axon pour tester).")}</li>
            <li><strong>{t("Connecter une table existante")}</strong> {t("que vous avez importée dans Supabase (ex : leads_rdv).")}</li>
          </ul>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button onClick={() => setShowCreate(true)}>{t("+ Créer une table")}</button>
            <button className="ghost" onClick={() => setShowConnect(true)}>🔌 {t("Connecter une table existante")}</button>
          </div>
        </div>
      ) : (
        <div className="grid cols-3">
          {tables.map((tbl) => (
            <Link
              key={tbl.id}
              href={`/contacts/${tbl.id}`}
              className="card"
              style={{ textDecoration: "none", display: "grid", gap: 6 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <h3 style={{ margin: 0 }}>{tbl.label}</h3>
                <span className="tag">{tbl.row_count} {t("contact")}{tbl.row_count === 1 ? "" : "s"}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>
                {tbl.physical_table}
                {!tbl.is_managed && <span className="tag" style={{ marginLeft: 6 }}>{t("connectée")}</span>}
              </div>
              <div className="row" style={{ flexWrap: "wrap", marginTop: 6 }}>
                {(tbl.columns ?? []).slice(0, 6).map((c) => (
                  <span key={c.key} className="tag">{c.label}</span>
                ))}
                {(tbl.columns ?? []).length > 6 && <span className="tag">+{tbl.columns.length - 6}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && <CreateDataTableModal onClose={() => setShowCreate(false)} onCreated={onDone} />}
      {showConnect && <ConnectTableModal onClose={() => setShowConnect(false)} onConnected={onDone} />}
    </>
  );
}
