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
  "Medical clinic",
  "Hotel",
  "Restaurant",
  "Call center",
  "Law firm",
  "Car dealership",
  "Real estate agency",
  "E-commerce",
  "Other",
];

function fmt(dt: string | null): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleDateString();
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
      return <span className="tag">active</span>;
    case "suspended":
      return (
        <span className="tag" style={{ background: "#b58105", color: "white" }}>
          suspended
        </span>
      );
    case "archived":
      return (
        <span className="tag" style={{ background: "#555", color: "white" }}>
          archived
        </span>
      );
    case "pending_deletion": {
      const d = daysUntil(deletionAt);
      return (
        <span className="tag" style={{ background: "var(--bad)", color: "white" }}>
          {"deletion in " + String(d ?? "?") + "d"}
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
      setErr("Name is required.");
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
        setErr(body.error || `Error ${r.status}`);
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
      setErr(body.error || `Error ${r.status}`);
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
      setErr(body.error || `Error ${r.status}`);
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
          {rows.filter((r) => r.status === "active").length} active
        </div>
        {!showForm && (
          <button className="primary" onClick={() => setShowForm(true)}>
            + Create new client
          </button>
        )}
      </div>

      {/* ── Create-client wizard (collapsed by default) ──────────────── */}
      {showForm && (
        <form onSubmit={createOrg} className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Create new client</div>
            <button
              type="button"
              className="ghost"
              onClick={resetForm}
              style={{ fontSize: 12 }}
            >
              Cancel
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                Client name *
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
                Slug (future subdomain)
              </label>
              <input
                placeholder="auto-generated if empty"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                style={{ width: "100%", padding: "6px 8px" }}
              />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                Category
              </label>
              <input
                list="org-categories"
                placeholder="Choose or type a category"
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
              Owner account (optional)
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              If filled in, we create the client owner account with the{" "}
              <span className="kbd">owner</span> role and show you the credentials to pass on.
              Otherwise, you can invite the owner later via the Administration page.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Owner email
                </label>
                <input
                  type="email"
                  placeholder="owner@client.com"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  style={{ width: "100%", padding: "6px 8px" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Name (optional)
                </label>
                <input
                  placeholder="Dr Smith"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  style={{ width: "100%", padding: "6px 8px" }}
                />
              </div>
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Password (empty = auto-generated)
                </label>
                <input
                  type="text"
                  placeholder="16 random characters if empty"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  style={{ width: "100%", padding: "6px 8px" }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={submitting || pending} className="primary">
              {submitting ? "Creating…" : "Create client"}
            </button>
          </div>
          {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
        </form>
      )}

      {err && !showForm && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}

      {/* ── Clients table ─────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>No clients yet. Create one above.</div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Category</th>
                <th style={{ textAlign: "right" }}>Members</th>
                <th style={{ textAlign: "right" }}>Calls (7d)</th>
                <th>Created</th>
                <th>Status</th>
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
                      Log in as
                    </button>
                    {r.status === "active" && (
                      <>
                        <button
                          className="ghost"
                          onClick={() => changeStatus(r.id, "suspended")}
                          disabled={pending}
                          style={{ fontSize: 12, marginRight: 6 }}
                          title="Login blocked, data preserved, billing maintained"
                        >
                          Suspend
                        </button>
                        <button
                          className="ghost"
                          onClick={() => changeStatus(r.id, "archived")}
                          disabled={pending}
                          style={{ fontSize: 12, marginRight: 6 }}
                          title="Read-only, no billing"
                        >
                          Archive
                        </button>
                        <button
                          className="ghost"
                          onClick={() => setPendingAction({ id: r.id, status: "pending_deletion", name: r.name })}
                          disabled={pending}
                          style={{ fontSize: 12, color: "var(--bad)" }}
                          title="Deletion scheduled in 30 days"
                        >
                          Delete
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
                          Reactivate
                        </button>
                        <button
                          className="ghost"
                          onClick={() => setPendingAction({ id: r.id, status: "pending_deletion", name: r.name })}
                          disabled={pending}
                          style={{ fontSize: 12, color: "var(--bad)" }}
                        >
                          Delete
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
                        Cancel deletion
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
        <Modal onClose={() => setCredentialsModal(null)} title={`Client "${credentialsModal.org}" created`}>
          {credentialsModal.owner.created ? (
            <>
              <p>
                The owner account has been created. <strong>Share these credentials with the client owner</strong> —
                they will not be shown again.
              </p>
              <div className="card" style={{ padding: 12, marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Email</div>
                <div style={{ fontFamily: "monospace", marginBottom: 8 }}>{credentialsModal.owner.email}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Initial password</div>
                <div style={{ fontFamily: "monospace" }}>{credentialsModal.owner.password}</div>
              </div>
              <button
                style={{ marginTop: 12 }}
                onClick={() => {
                  const txt = `Email: ${credentialsModal.owner.email}\nPassword: ${credentialsModal.owner.password}`;
                  navigator.clipboard?.writeText(txt);
                }}
              >
                Copy credentials
              </button>
            </>
          ) : (
            <p>
              The user <strong>{credentialsModal.owner.email}</strong> already existed — they have simply been
              added as <span className="kbd">owner</span> of this new client. Their password remains unchanged.
            </p>
          )}
        </Modal>
      )}

      {/* ── Delete confirmation modal ──────────────────────────────── */}
      {pendingAction && (
        <Modal
          onClose={() => setPendingAction(null)}
          title="Confirm deletion"
        >
          <p>
            Client <strong>{pendingAction.name}</strong> will be marked for deletion. For{" "}
            <strong>30 days</strong>, their data remains recoverable (GDPR). After that, automatic permanent deletion.
          </p>
          <p>
            You can cancel at any time within those 30 days by clicking <em>Cancel deletion</em>.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => changeStatus(pendingAction.id, pendingAction.status)} className="primary">
              Confirm deletion
            </button>
            <button onClick={() => setPendingAction(null)} className="ghost">
              Cancel
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
