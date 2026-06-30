"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

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
  const t = useT();
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
    if (!confirm(t("Retirer cet utilisateur de l'organisation ?"))) return;
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
    setCreateOk(`${newEmail} ` + t("créé. Partagez le mot de passe avec l'utilisateur."));
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
    if (!confirm(t("Révoquer cette invitation ?"))) return;
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
      setError(t("Copie échouée"));
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
          {(["users", "invitations", "settings"] as Tab[]).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={tab === tabKey ? "" : "ghost"}
              style={{ textTransform: "capitalize" }}
            >
              {tabKey === "users" ? t("Utilisateurs") : tabKey === "invitations" ? t("Invitations") : t("Paramètres")}
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
            <h3 style={{ marginTop: 0 }}>{t("Créer un utilisateur (email + mot de passe)")}</h3>
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
                  <label>{t("Nom complet (optionnel)")}</label>
                  <input
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="John Smith"
                  />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>{t("Mot de passe (min. 8 caractères)")}</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t("Mot de passe initial")}
                  />
                </div>
                <div>
                  <label>{t("Rôle")}</label>
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
                  {createBusy ? "…" : t("Créer l'utilisateur")}
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("L'utilisateur est créé avec un email vérifié et peut se connecter immédiatement avec le mot de passe que vous lui communiquez. Pour un flux magic-link, utilisez l'onglet Invitations.")}
              </div>
            </form>
          </div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 16, color: "var(--muted)" }}>{t("Chargement…")}</div>
          ) : members.length === 0 ? (
            <div style={{ padding: 16, color: "var(--muted)" }}>
              {t("Aucun membre dans cette organisation.")}
            </div>
          ) : (
            <table className="list">
              <thead>
                <tr>
                  <th>{t("Nom")}</th>
                  <th>Email</th>
                  <th>{t("Rôle")}</th>
                  <th>{t("Dernière connexion")}</th>
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
                        {t("Retirer")}
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
            <h3 style={{ marginTop: 0 }}>{t("Inviter un utilisateur")}</h3>
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
                  <label>{t("Rôle")}</label>
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
                  {inviteBusy ? "…" : t("Créer l'invitation")}
                </button>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("L'envoi d'email n'est pas encore configuré : copiez le lien généré et partagez-le manuellement.")}
              </div>
            </form>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {invites.length === 0 ? (
              <div style={{ padding: 16, color: "var(--muted)" }}>
                {t("Aucune invitation en attente.")}
              </div>
            ) : (
              <table className="list">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>{t("Rôle")}</th>
                    <th>{t("Créée le")}</th>
                    <th>{t("Expire le")}</th>
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
                          {copied === i.id ? t("Copié !") : t("Copier le lien")}
                        </button>
                        <button
                          className="danger"
                          style={{ padding: "5px 9px" }}
                          onClick={() => revokeInvite(i.id)}
                        >
                          {t("Révoquer")}
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
          <h3 style={{ marginTop: 0 }}>{t("Paramètres de l'organisation")}</h3>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <label>{t("Nom")}</label>
              <input value={orgName} readOnly />
            </div>
            <div>
              <label>Slug</label>
              <input value={orgSlug} readOnly />
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("La modification de ces champs sera disponible prochainement.")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
