"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
        <button onClick={() => setShowCreate(true)}>+ Créer une table</button>
        <button className="ghost" onClick={() => setShowConnect(true)}>
          🔌 Connecter une table existante
        </button>
      </div>

      {tables.length === 0 ? (
        <div className="card">
          <h3>Aucune table de contacts</h3>
          <p className="muted">
            Une « table » contient les contacts à appeler, avec vos propres colonnes
            (téléphone, nom, IMC, qualification…). Vous pouvez&nbsp;:
          </p>
          <ul className="muted" style={{ marginTop: 0 }}>
            <li><strong>Créer une table</strong> directement ici (ex&nbsp;: <em>leads_rdv_test_axon</em> pour tester).</li>
            <li><strong>Connecter une table existante</strong> que vous avez importée dans Supabase (ex&nbsp;: <em>leads_rdv</em>).</li>
          </ul>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button onClick={() => setShowCreate(true)}>+ Créer une table</button>
            <button className="ghost" onClick={() => setShowConnect(true)}>🔌 Connecter une table existante</button>
          </div>
        </div>
      ) : (
        <div className="grid cols-3">
          {tables.map((t) => (
            <Link
              key={t.id}
              href={`/contacts/${t.id}`}
              className="card"
              style={{ textDecoration: "none", display: "grid", gap: 6 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <h3 style={{ margin: 0 }}>{t.label}</h3>
                <span className="tag">{t.row_count} contact{t.row_count === 1 ? "" : "s"}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "monospace" }}>
                {t.physical_table}
                {!t.is_managed && <span className="tag" style={{ marginLeft: 6 }}>connectée</span>}
              </div>
              <div className="row" style={{ flexWrap: "wrap", marginTop: 6 }}>
                {(t.columns ?? []).slice(0, 6).map((c) => (
                  <span key={c.key} className="tag">{c.label}</span>
                ))}
                {(t.columns ?? []).length > 6 && <span className="tag">+{t.columns.length - 6}</span>}
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
