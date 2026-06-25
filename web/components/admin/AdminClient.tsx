"use client";

import { useEffect, useState } from "react";

interface Member {
  id: string;
  org_id: string;
  user_id: string;
  role: string;
  created_at: string;
  email: string | null;
  display_name: string | null;
  last_seen: string | null;
}

interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role: string;
  token: string;
  accepted_at: string | null;
  expires_at: string | null;
  created_at: string;
  accept_url: string;
}

const ROLES = ["super_admin", "admin", "manager", "supervisor", "agent"] as const;

type Tab = "users" | "invitations" | "settings";

export function AdminClient({
  orgId,
  orgName,
  orgSlug,
}: {
  orgId: string;
  orgName: string;
  orgSlug: string;
}) {
  const [tab, setTab] = useState<Tab>("users");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invitation form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("agent");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Direct user creation (email + password)
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState<string>("agent");
  const [createBusy, setCreateBusy] = useState(false);
  const [createOk, setCreateOk] = useState<string | null>(null);

  async function refreshUsers() {
    const r = await fetch(`/api/admin/users?org_id=${orgId}`);
    if (r.ok) setMembers(await r.json());
  }
  async function refreshInvites() {
    const r = await fetch(`/api/admin/invitations?org_id=${orgId}`);
    if (r.ok) setInvites(await r.json());
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([refreshUsers(), refreshInvites()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function changeRole(userId: string, role: string) {
    const r = await fetch(`/api/admin/users`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: userId, role, org_id: orgId }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Error changing role");
      return;
    }
    setError(null);
    refreshUsers();
  }

  async function removeMember(userId: string) {
    if (!confirm("Remove this user from the organisation?")) return;
    const r = await fetch(
      `/api/admin/users?user_id=${encodeURIComponent(userId)}&org_id=${encodeURIComponent(orgId)}`,
      { method: "DELETE" },
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Error removing user");
      return;
    }
    setError(null);
    refreshUsers();
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateBusy(true);
    setError(null);
    setCreateOk(null);
    const r = await fetch(`/api/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: newEmail,
        password: newPassword,
        role: newRole,
        display_name: newDisplayName || undefined,
        org_id: orgId,
      }),
    });
    setCreateBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Error creating user");
      return;
    }
    setCreateOk(`${newEmail} created. Share the password with the user.`);
    setNewEmail(""); setNewPassword(""); setNewDisplayName(""); setNewRole("agent");
    refreshUsers();
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteBusy(true);
    setError(null);
    const r = await fetch(`/api/admin/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole, org_id: orgId }),
    });
    setInviteBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Error creating invitation");
      return;
    }
    setInviteEmail("");
    setInviteRole("agent");
    refreshInvites();
  }

  async function revokeInvite(id: string) {
    if (!confirm("Revoke this invitation?")) return;
    const r = await fetch(`/api/admin/invitations?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Error revoking invitation");
      return;
    }
    refreshInvites();
  }

  async function copyLink(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Copy failed");
    }
  }

  function fmt(dt: string | null): string {
    if (!dt) return "—";
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return dt;
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card" style={{ padding: 8 }}>
        <nav style={{ display: "flex", gap: 6 }}>
          {(["users", "invitations", "settings"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={tab === t ? "" : "ghost"}
              style={{ textTransform: "capitalize" }}
            >
              {t === "users" ? "Users" : t === "invitations" ? "Invitations" : "Settings"}
            </button>
          ))}
        </nav>
      </div>

      {error && (
        <div className="card" style={{ color: "var(--bad)" }}>
          {error}
        </div>
      )}

      {tab === "users" && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Create a user (email + password)</h3>
            <form onSubmit={createUser} style={{ display: "grid", gap: 10 }}>
              <div className="form-row">
                <div>
                  <label>Email</label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="user@example.com"
                  />
                </div>
                <div>
                  <label>Full name (optional)</label>
                  <input
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="John Smith"
                  />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Password (min. 8 characters)</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Initial password"
                  />
                </div>
                <div>
                  <label>Role</label>
                  <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              {createOk && (
                <div style={{ color: "var(--good)", fontSize: 13 }}>{createOk}</div>
              )}
              <div>
                <button type="submit" disabled={createBusy || !newEmail || newPassword.length < 8}>
                  {createBusy ? "…" : "Create user"}
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                The user is created with a verified email and can log in immediately
                with the password you share with them. For a magic-link flow, use the
                Invitations tab instead.
              </div>
            </form>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 16, color: "var(--muted)" }}>Loading…</div>
          ) : members.length === 0 ? (
            <div style={{ padding: 16, color: "var(--muted)" }}>
              No members in this organisation.
            </div>
          ) : (
            <table className="list">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Last login</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.display_name ?? <em style={{ color: "var(--muted)" }}>—</em>}
                    </td>
                    <td>
                      {m.email ? (
                        <span className="kbd">{m.email}</span>
                      ) : (
                        <em style={{ color: "var(--muted)" }}>—</em>
                      )}
                    </td>
                    <td>
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.user_id, e.target.value)}
                        style={{ width: "auto", padding: "5px 8px" }}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                        {!ROLES.includes(m.role as typeof ROLES[number]) && (
                          <option value={m.role}>{m.role}</option>
                        )}
                      </select>
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 13 }}>{fmt(m.last_seen)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="danger"
                        style={{ padding: "5px 9px" }}
                        onClick={() => removeMember(m.user_id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </>
      )}

      {tab === "invitations" && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Invite a user</h3>
            <form onSubmit={createInvite} style={{ display: "grid", gap: 10 }}>
              <div className="form-row">
                <div>
                  <label>Email</label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="user@example.com"
                  />
                </div>
                <div>
                  <label>Role</label>
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <button type="submit" disabled={inviteBusy || !inviteEmail}>
                  {inviteBusy ? "…" : "Create invitation"}
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                Email sending is not yet configured: copy the generated link and share it manually.
              </div>
            </form>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {invites.length === 0 ? (
              <div style={{ padding: 16, color: "var(--muted)" }}>
                No pending invitations.
              </div>
            ) : (
              <table className="list">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <span className="kbd">{i.email}</span>
                      </td>
                      <td>
                        <span className="tag">{i.role}</span>
                      </td>
                      <td style={{ color: "var(--muted)", fontSize: 13 }}>
                        {fmt(i.created_at)}
                      </td>
                      <td style={{ color: "var(--muted)", fontSize: 13 }}>{fmt(i.expires_at)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          className="subtle"
                          style={{ padding: "5px 9px", marginRight: 6 }}
                          onClick={() => copyLink(i.accept_url, i.id)}
                        >
                          {copied === i.id ? "Copied!" : "Copy link"}
                        </button>
                        <button
                          className="danger"
                          style={{ padding: "5px 9px" }}
                          onClick={() => revokeInvite(i.id)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "settings" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Organisation settings</h3>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <label>Name</label>
              <input value={orgName} readOnly />
            </div>
            <div>
              <label>Slug</label>
              <input value={orgSlug} readOnly />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              Editing these fields will be available soon.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
