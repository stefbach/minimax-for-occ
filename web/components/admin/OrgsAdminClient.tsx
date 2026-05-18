"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  active: boolean;
  members: number;
  calls_7d: number;
}

function fmt(dt: string): string {
  try {
    return new Date(dt).toLocaleDateString("fr-FR");
  } catch {
    return dt;
  }
}

export function OrgsAdminClient({ initial }: { initial: OrgRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<OrgRow[]>(initial);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr("Le nom est requis.");
      return;
    }
    const r = await fetch("/api/admin/orgs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name: name.trim(), slug: slug.trim() || undefined }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setErr(body.error || `Erreur ${r.status}`);
      return;
    }
    setName("");
    setSlug("");
    startTransition(() => router.refresh());
  }

  async function toggleActive(id: string, next: boolean) {
    const r = await fetch("/api/admin/orgs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id, active: next }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setErr(body.error || `Erreur ${r.status}`);
      return;
    }
    setRows((prev) => prev.map((o) => (o.id === id ? { ...o, active: next } : o)));
    startTransition(() => router.refresh());
  }

  async function impersonate(id: string) {
    const r = await fetch(`/api/admin/orgs/${id}/impersonate`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setErr(body.error || `Erreur ${r.status}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <form onSubmit={createOrg} className="card" style={{ padding: 16, display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Créer une organisation</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Nom"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: "1 1 200px", padding: "6px 8px" }}
          />
          <input
            placeholder="Slug (optionnel)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            style={{ flex: "1 1 200px", padding: "6px 8px" }}
          />
          <button type="submit" disabled={pending} className="primary">
            Créer
          </button>
        </div>
        {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
      </form>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>Aucune organisation.</div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Slug</th>
                <th style={{ textAlign: "right" }}>Membres</th>
                <th style={{ textAlign: "right" }}>Appels (7j)</th>
                <th>Créée le</th>
                <th>Statut</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
                  <td>{r.name}</td>
                  <td>
                    <span className="kbd">{r.slug}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{r.members}</td>
                  <td style={{ textAlign: "right" }}>{r.calls_7d}</td>
                  <td style={{ color: "var(--muted)", fontSize: 13 }}>{fmt(r.created_at)}</td>
                  <td>
                    {r.active ? (
                      <span className="tag">actif</span>
                    ) : (
                      <span className="tag" style={{ background: "var(--bad)", color: "white" }}>
                        désactivé
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      className="ghost"
                      onClick={() => impersonate(r.id)}
                      disabled={pending}
                      style={{ fontSize: 12, marginRight: 6 }}
                    >
                      Se connecter
                    </button>
                    <button
                      className="ghost"
                      onClick={() => toggleActive(r.id, !r.active)}
                      disabled={pending}
                      style={{ fontSize: 12 }}
                    >
                      {r.active ? "Désactiver" : "Réactiver"}
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
