"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Contact {
  id: string;
  e164: string;
  display_name: string | null;
  email: string | null;
  tags: string[];
  notes: string | null;
  created_at: string;
}

export function ContactsClient({ initial }: { initial: Contact[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Contact[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [e164, setE164] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");

  // Search bar: matches any of name / e164 / email / tags. Updates
  // as the user types, no debouncing needed since the list is in-memory.
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) => {
      if (c.display_name?.toLowerCase().includes(q)) return true;
      if (c.e164.toLowerCase().includes(q)) return true;
      if (c.email?.toLowerCase().includes(q)) return true;
      if ((c.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [rows, search]);

  async function refresh() {
    const r = await fetch("/api/contacts");
    if (r.ok) setRows(await r.json());
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        e164,
        display_name: name || null,
        email: email || null,
        tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        notes: notes || null,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Erreur");
      return;
    }
    setE164(""); setName(""); setEmail(""); setTags(""); setNotes("");
    refresh();
  }

  async function del(id: string) {
    if (!confirm("Supprimer ce contact ?")) return;
    await fetch(`/api/contacts?id=${id}`, { method: "DELETE" });
    refresh();
  }

  /**
   * Click-to-dial: navigate the softphone with the contact's number
   * pre-filled in the URL. /desk reads ?call=<e164> on mount and
   * fires the dial automatically.
   */
  function callContact(c: Contact) {
    const qs = new URLSearchParams({ call: c.e164 });
    if (c.display_name) qs.set("name", c.display_name);
    router.push(`/desk?${qs.toString()}`);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Ajouter un contact manuellement</h3>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
          <div className="form-row">
            <div>
              <label>Numéro (E.164)</label>
              <input value={e164} onChange={(e) => setE164(e.target.value)} placeholder="+33600000000" required pattern="\+?[0-9]{6,15}" />
            </div>
            <div>
              <label>Nom</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Stéphane Dupond" />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@example.com" />
            </div>
            <div>
              <label>Tags (séparés par virgule)</label>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, jamais-rappeler, fr" />
            </div>
          </div>
          <div>
            <label>Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>}
          <div>
            <button type="submit" disabled={busy || !e164}>
              {busy ? "…" : "Ajouter / mettre à jour"}
            </button>
          </div>
        </form>
      </div>

      {/* Search bar — filters the contact list as you type. */}
      <div className="card" style={{ padding: 12 }}>
        <div className="form-row" style={{ alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un contact (nom, numéro, email, tag…)"
              style={{ width: "100%", padding: "8px 12px", fontSize: 14 }}
            />
          </div>
          <div className="muted" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
            {filtered.length} / {rows.length} contact{rows.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>
            {rows.length === 0
              ? "Aucun contact pour l'instant. Ajoute-en un manuellement ci-dessus."
              : "Aucun contact ne correspond à ta recherche."}
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Téléphone</th>
                <th>Email</th>
                <th>Tags</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>{c.display_name ?? <em style={{ color: "var(--muted)" }}>—</em>}</td>
                  <td><span className="kbd">{c.e164}</span></td>
                  <td>{c.email ?? <em style={{ color: "var(--muted)" }}>—</em>}</td>
                  <td>
                    {(c.tags ?? []).map((t) => (
                      <span key={t} className="tag" style={{ marginRight: 4 }}>{t}</span>
                    ))}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => callContact(c)}
                      style={{ padding: "5px 10px", marginRight: 6 }}
                      title="Appeler ce contact depuis le softphone"
                    >
                      ☎ Appeler
                    </button>
                    <button className="danger" style={{ padding: "5px 9px" }} onClick={() => del(c.id)}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
