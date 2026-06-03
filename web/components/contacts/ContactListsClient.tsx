"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CreateListModal } from "./CreateListModal";

interface ListRow {
  id: string;
  name: string;
  description: string | null;
  columns: unknown;
  contact_count: number;
  updated_at: string;
}

interface Props {
  initialLists: ListRow[];
  unsortedCount: number;
}

export function ContactListsClient({ initialLists, unsortedCount }: Props) {
  const router = useRouter();
  const [lists, setLists] = useState<ListRow[]>(initialLists);
  const [showCreate, setShowCreate] = useState(false);

  function onCreated(newList: ListRow) {
    setLists((prev) => [{ ...newList, contact_count: 0 }, ...prev]);
    setShowCreate(false);
    // Jump straight into the new base — that's where the user wants to be.
    router.push(`/contacts/${newList.id}`);
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setShowCreate(true)}>+ Créer une base</button>
        {unsortedCount > 0 && (
          <Link href="/contacts/unsorted">
            <button className="ghost">
              📂 {unsortedCount} contact{unsortedCount === 1 ? "" : "s"} non classé{unsortedCount === 1 ? "" : "s"}
            </button>
          </Link>
        )}
      </div>

      {lists.length === 0 ? (
        <div className="card">
          <h3>Aucune base de contacts</h3>
          <p className="muted">
            Une « base » regroupe les contacts d&apos;un même usage (ex&nbsp;: <em>leads_rdv_test</em>{" "}
            pour tester, <em>leads_rdv_prod</em> pour les vrais appels). Chaque base a ses propres
            colonnes (téléphone, email, IMC, notes, etc.).
          </p>
          <div style={{ marginTop: 12 }}>
            <button onClick={() => setShowCreate(true)}>+ Créer ma première base</button>
          </div>
        </div>
      ) : (
        <div className="grid cols-3">
          {lists.map((l) => {
            const cols = Array.isArray(l.columns) ? (l.columns as Array<{ key: string; label: string }>) : [];
            return (
              <Link
                key={l.id}
                href={`/contacts/${l.id}`}
                className="card"
                style={{ textDecoration: "none", display: "grid", gap: 6 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <h3 style={{ margin: 0 }}>{l.name}</h3>
                  <span className="tag">{l.contact_count} contact{l.contact_count === 1 ? "" : "s"}</span>
                </div>
                {l.description && (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>{l.description}</p>
                )}
                <div className="row" style={{ flexWrap: "wrap", marginTop: 6 }}>
                  {cols.slice(0, 6).map((c) => (
                    <span key={c.key} className="tag">{c.label}</span>
                  ))}
                  {cols.length > 6 && <span className="tag">+{cols.length - 6}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateListModal onClose={() => setShowCreate(false)} onCreated={onCreated} />
      )}
    </>
  );
}
