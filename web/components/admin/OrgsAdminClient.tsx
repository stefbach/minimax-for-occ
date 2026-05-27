"use client";

import { useState, useTransition, type ReactElement } from "react";
import { useRouter } from "next/navigation";

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  created_at: string;
  active: boolean;
  status: "active" | "suspended" | "archived" | "pending_deletion";
  deletion_scheduled_at: string | null;
  members: number;
  calls_7d: number;
}

type Status = OrgRow["status"];

interface OwnerCredentials {
  email: string;
  password: string;
  created: boolean;
}

// Free-form category with suggestions. The user can type anything; the
// datalist just nudges toward common verticals so spelling stays consistent.
const CATEGORY_SUGGESTIONS = [
  "Clinique médicale",
  "Hôtel",
  "Restaurant",
  "Call center",
  "Cabinet d'avocats",
  "Concessionnaire auto",
  "Agence immobilière",
  "E-commerce",
  "Autre",
];

function fmt(dt: string | null): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleDateString("fr-FR");
  } catch {
    return dt;
  }
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)));
}

function statusBadge(s: Status, deletionAt: string | null): ReactElement {
  switch (s) {
    case "active":
      return <span className="tag">actif</span>;
    case "suspended":
      return (
        <span className="tag" style={{ background: "#b58105", color: "white" }}>
          suspendu
        </span>
      );
    case "archived":
      return (
        <span className="tag" style={{ background: "#555", color: "white" }}>
          archivé
        </span>
      );
    case "pending_deletion": {
      const d = daysUntil(deletionAt);
      return (
        <span className="tag" style={{ background: "var(--bad)", color: "white" }}>
          suppression dans {d ?? "?"}j
        </span>
      );
    }
  }
}

export function OrgsAdminClient({ initial }: { initial: OrgRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<OrgRow[]>(initial);

  // Wizard form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [showForm, setShowForm] = useState(false);

  // Async / feedback state
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [credentialsModal, setCredentialsModal] = useState<{ org: string; owner: OwnerCredentials } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ id: string; status: Status; name: string } | null>(null);

  function resetForm() {
    setName("");
    setSlug("");
    setCategory("");
    setOwnerEmail("");
    setOwnerName("");
    setOwnerPassword("");
    setShowForm(false);
  }

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr("Le nom est requis.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/api/admin/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          category: category.trim() || undefined,
          owner_email: ownerEmail.trim() || undefined,
          owner_name: ownerName.trim() || undefined,
          owner_password: ownerPassword.trim() || undefined,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(body.error || `Erreur ${r.status}`);
        return;
      }
      // Show credentials modal if an owner was provisioned.
      if (body.owner) {
        setCredentialsModal({ org: name.trim(), owner: body.owner });
      }
      resetForm();
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(id: string, status: Status) {
    const r = await fetch("/api/admin/orgs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id, status }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setErr(body.error || `Erreur ${r.status}`);
      return;
    }
    setRows((prev) =>
      prev.map((o) =>
        o.id === id
          ? {
              ...o,
              status,
              active: status === "active",
              deletion_scheduled_at:
                status === "pending_deletion"
                  ? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
                  : null,
            }
          : o,
      ),
    );
    setPendingAction(null);
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
      {/* ── Header row : count + create button ────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="muted" style={{ fontSize: 13 }}>
          {rows.length} client{rows.length > 1 ? "s" : ""} —{" "}
          {rows.filter((r) => r.status === "active").length} actifs
        </div>
        {!showForm && (
          <button className="primary" onClick={() => setShowForm(true)}>
            + Créer un nouveau client
          </button>
        )}
      </div>

      {/* ── Create-client wizard (collapsed by default) ──────────────── */}
      {showForm && (
        <form onSubmit={createOrg} className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Créer un nouveau client</div>
            <button
              type="button"
              className="ghost"
              onClick={resetForm}
              style={{ fontSize: 12 }}
            >
              Annuler
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                Nom du client *
              </label>
              <input
                placeholder="Obesity Care Clinic"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{ width: "100%", padding: "6px 8px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                Slug (sous-domaine futur)
              </label>
              <input
                placeholder="auto-généré si vide"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                style={{ width: "100%", padding: "6px 8px" }}
              />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                Catégorie
              </label>
              <input
                list="org-categories"
                placeholder="Choisir ou taper une catégorie"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ width: "100%", padding: "6px 8px" }}
              />
              <datalist id="org-categories">
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>

          {/* ── Owner section ────────────────────────────────────────── */}
          <div style={{ marginTop: 8, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
              Compte propriétaire (optionnel)
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Si rempli, on crée le compte du patron du client avec le rôle{" "}
              <span className="kbd">owner</span> et on te montre les credentials à lui transmettre.
              Sinon, tu peux inviter l&apos;owner plus tard via la page Administration.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Email du propriétaire
                </label>
                <input
                  type="email"
                  placeholder="patron@client.com"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  style={{ width: "100%", padding: "6px 8px" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Nom (optionnel)
                </label>
                <input
                  placeholder="Dr Coste"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  style={{ width: "100%", padding: "6px 8px" }}
                />
              </div>
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Mot de passe (vide = généré automatiquement)
                </label>
                <input
                  type="text"
                  placeholder="16 caractères aléatoires si vide"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  style={{ width: "100%", padding: "6px 8px" }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={submitting || pending} className="primary">
              {submitting ? "Création…" : "Créer le client"}
            </button>
          </div>
          {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
        </form>
      )}

      {err && !showForm && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}

      {/* ── Clients table ─────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>Aucun client. Créez-en un ci-dessus.</div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Slug</th>
                <th>Catégorie</th>
                <th style={{ textAlign: "right" }}>Membres</th>
                <th style={{ textAlign: "right" }}>Appels (7j)</th>
                <th>Créé le</th>
                <th>Statut</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.status === "active" ? 1 : 0.6 }}>
                  <td>{r.name}</td>
                  <td>
                    <span className="kbd">{r.slug}</span>
                  </td>
                  <td style={{ color: "var(--muted)", fontSize: 13 }}>{r.category ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>{r.members}</td>
                  <td style={{ textAlign: "right" }}>{r.calls_7d}</td>
                  <td style={{ color: "var(--muted)", fontSize: 13 }}>{fmt(r.created_at)}</td>
                  <td>{statusBadge(r.status, r.deletion_scheduled_at)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      className="ghost"
                      onClick={() => impersonate(r.id)}
                      disabled={pending || r.status === "pending_deletion"}
                      style={{ fontSize: 12, marginRight: 6 }}
                    >
                      Se connecter
                    </button>
                    {r.status === "active" && (
                      <>
                        <button
                          className="ghost"
                          onClick={() => changeStatus(r.id, "suspended")}
                          disabled={pending}
                          style={{ fontSize: 12, marginRight: 6 }}
                          title="Login bloqué, données préservées, facturation maintenue"
                        >
                          Suspendre
                        </button>
                        <button
                          className="ghost"
                          onClick={() => changeStatus(r.id, "archived")}
                          disabled={pending}
                          style={{ fontSize: 12, marginRight: 6 }}
                          title="Lecture seule, plus de facturation"
                        >
                          Archiver
                        </button>
                        <button
                          className="ghost"
                          onClick={() => setPendingAction({ id: r.id, status: "pending_deletion", name: r.name })}
                          disabled={pending}
                          style={{ fontSize: 12, color: "var(--bad)" }}
                          title="Suppression programmée à J+30"
                        >
                          Supprimer
                        </button>
                      </>
                    )}
                    {(r.status === "suspended" || r.status === "archived") && (
                      <>
                        <button
                          className="ghost"
                          onClick={() => changeStatus(r.id, "active")}
                          disabled={pending}
                          style={{ fontSize: 12, marginRight: 6 }}
                        >
                          Réactiver
                        </button>
                        <button
                          className="ghost"
                          onClick={() => setPendingAction({ id: r.id, status: "pending_deletion", name: r.name })}
                          disabled={pending}
                          style={{ fontSize: 12, color: "var(--bad)" }}
                        >
                          Supprimer
                        </button>
                      </>
                    )}
                    {r.status === "pending_deletion" && (
                      <button
                        className="ghost"
                        onClick={() => changeStatus(r.id, "active")}
                        disabled={pending}
                        style={{ fontSize: 12 }}
                      >
                        Annuler la suppression
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Credentials modal (after creating an owner) ─────────────── */}
      {credentialsModal && (
        <Modal onClose={() => setCredentialsModal(null)} title={`Client "${credentialsModal.org}" créé`}>
          {credentialsModal.owner.created ? (
            <>
              <p>
                Le compte propriétaire a été créé. <strong>Transmets ces identifiants au patron du client</strong> —
                ils ne seront plus jamais affichés.
              </p>
              <div className="card" style={{ padding: 12, marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Email</div>
                <div style={{ fontFamily: "monospace", marginBottom: 8 }}>{credentialsModal.owner.email}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Mot de passe initial</div>
                <div style={{ fontFamily: "monospace" }}>{credentialsModal.owner.password}</div>
              </div>
              <button
                style={{ marginTop: 12 }}
                onClick={() => {
                  const txt = `Email: ${credentialsModal.owner.email}\nMot de passe: ${credentialsModal.owner.password}`;
                  navigator.clipboard?.writeText(txt);
                }}
              >
                Copier les credentials
              </button>
            </>
          ) : (
            <p>
              L&apos;utilisateur <strong>{credentialsModal.owner.email}</strong> existait déjà — il a simplement été
              ajouté comme <span className="kbd">owner</span> de ce nouveau client. Son mot de passe reste inchangé.
            </p>
          )}
        </Modal>
      )}

      {/* ── Delete confirmation modal ──────────────────────────────── */}
      {pendingAction && (
        <Modal
          onClose={() => setPendingAction(null)}
          title="Confirmer la suppression"
        >
          <p>
            Le client <strong>{pendingAction.name}</strong> sera marqué pour suppression. Pendant{" "}
            <strong>30 jours</strong>, ses données restent récupérables (RGPD). Passé ce délai, suppression
            définitive automatique.
          </p>
          <p>
            Tu peux annuler à tout moment pendant ces 30 jours en cliquant <em>Annuler la suppression</em>.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => changeStatus(pendingAction.id, pendingAction.status)} className="primary">
              Confirmer la suppression
            </button>
            <button onClick={() => setPendingAction(null)} className="ghost">
              Annuler
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ maxWidth: 520, width: "calc(100% - 32px)", padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{title}</div>
          <button onClick={onClose} className="ghost" style={{ fontSize: 16 }}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
