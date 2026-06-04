"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import type { TeamMember, TeamMembersResponse } from "@/app/api/team/members/route";
import type { PendingInvitation, InvitesListResponse } from "@/app/api/team/invites/route";

const ROLE_LABEL: Record<string, { label: string; tone: string }> = {
  super_admin: { label: "Super admin", tone: "var(--bad)" },
  owner:       { label: "Owner",       tone: "var(--accent)" },
  admin:       { label: "Admin",       tone: "var(--info)" },
  manager:     { label: "Manager",     tone: "var(--accent-2)" },
  supervisor:  { label: "Supervisor",  tone: "var(--accent-2)" },
  agent:       { label: "Agent",       tone: "var(--good)" },
  viewer:      { label: "Viewer",      tone: "var(--muted)" },
  analyst:     { label: "Analyst",     tone: "var(--muted)" },
};

const INVITE_ROLES = ["owner", "admin", "manager", "agent", "viewer"] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

type ToastState = { kind: "ok" | "err"; msg: string } | null;

export function TeamList({ inviteOpenSignal = 0 }: { inviteOpenSignal?: number }) {
  const t = useT();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [mr, ir] = await Promise.all([
        fetch("/api/team/members", { cache: "no-store" }),
        fetch("/api/team/invites", { cache: "no-store" }),
      ]);
      const mj = (await mr.json()) as TeamMembersResponse | { error?: string };
      if (!mr.ok) throw new Error(("error" in mj && mj.error) || `HTTP ${mr.status}`);
      setMembers((mj as TeamMembersResponse).members ?? []);
      if (ir.ok) {
        const ij = (await ir.json()) as InvitesListResponse;
        setInvitations(ij.invitations ?? []);
      } else {
        setInvitations([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // External open signal — the page's "+ Inviter" button bumps a counter.
  useEffect(() => {
    if (inviteOpenSignal > 0) setInviteOpen(true);
  }, [inviteOpenSignal]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const showToast = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
  }, []);

  if (loading) {
    return <div className="card"><p className="muted" style={{ margin: 0 }}>{t("Chargement…")}</p></div>;
  }
  if (error) {
    return <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>;
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {toast && (
        <div
          className="card"
          style={{
            borderColor: toast.kind === "ok" ? "var(--good)" : "var(--bad)",
            color: toast.kind === "ok" ? "var(--good)" : "var(--bad)",
          }}
        >
          {toast.msg}
        </div>
      )}

      {invitations.length > 0 && (
        <PendingSection
          rows={invitations}
          onChanged={reload}
          onToast={showToast}
        />
      )}

      <MembersTable members={members} onChanged={reload} onToast={showToast} />

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onSent={() => {
            void reload();
          }}
          onToast={showToast}
        />
      )}
    </div>
  );
}

function MembersTable({
  members,
  onChanged,
  onToast,
}: {
  members: TeamMember[];
  onChanged: () => void;
  onToast: (k: "ok" | "err", m: string) => void;
}) {
  const t = useT();
  if (members.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          {t("Aucun membre — ajoutez-en via le bouton Inviter.")}
        </p>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="list" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>{t("Membre")}</th>
            <th>{t("Rôle")}</th>
            <th>{t("Statut")}</th>
            <th>{t("Ajouté le")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <MemberRow key={m.user_id} member={m} onChanged={onChanged} onToast={onToast} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberRow({
  member: m,
  onChanged,
  onToast,
}: {
  member: TeamMember;
  onChanged: () => void;
  onToast: (k: "ok" | "err", msg: string) => void;
}) {
  const t = useT();
  const roleInfo = ROLE_LABEL[m.role] ?? { label: m.role, tone: "var(--muted)" };
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingRole, setEditingRole] = useState(false);
  const [newRole, setNewRole] = useState<string>(m.role);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest(`[data-row-menu="${m.user_id}"]`)) setMenuOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen, m.user_id]);

  async function saveRole() {
    if (newRole === m.role) {
      setEditingRole(false);
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/team/members/${m.user_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      onToast("ok", t("Rôle mis à jour."));
      setEditingRole(false);
      onChanged();
    } catch (e) {
      onToast("err", e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    const willDisable = m.status === "active";
    const msg = willDisable ? t("Désactiver ce membre ?") : t("Réactiver ce membre ?");
    if (!window.confirm(msg)) return;
    setBusy(true);
    setMenuOpen(false);
    try {
      const r = await fetch(`/api/team/members/${m.user_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ is_active: !willDisable }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      onToast("ok", willDisable ? t("Membre désactivé.") : t("Membre réactivé."));
      onChanged();
    } catch (e) {
      onToast("err", e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <div style={{ fontWeight: 500 }}>
          {m.display_name || m.email || "—"}
          {m.is_self && (
            <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
              ({t("vous")})
            </span>
          )}
        </div>
        {m.email && m.display_name && (
          <div className="muted" style={{ fontSize: 12 }}>{m.email}</div>
        )}
      </td>
      <td>
        {editingRole ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              disabled={busy}
              style={{ padding: "4px 6px", fontSize: 12 }}
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(ROLE_LABEL[r]?.label ?? r)}
                </option>
              ))}
            </select>
            <button
              className="ghost"
              onClick={saveRole}
              disabled={busy}
              style={{ padding: "2px 8px", fontSize: 12 }}
            >
              {t("Enregistrer")}
            </button>
            <button
              className="ghost"
              onClick={() => {
                setEditingRole(false);
                setNewRole(m.role);
              }}
              disabled={busy}
              style={{ padding: "2px 8px", fontSize: 12 }}
            >
              {t("Annuler")}
            </button>
          </div>
        ) : (
          <span className="tag" style={{ color: roleInfo.tone, borderColor: roleInfo.tone }}>
            {t(roleInfo.label)}
          </span>
        )}
      </td>
      <td>
        <span
          className={`tag ${m.status === "active" ? "good" : ""}`}
          style={m.status === "disabled" ? { color: "var(--muted)" } : {}}
        >
          {m.status === "active" ? t("Actif") : t("Désactivé")}
        </span>
      </td>
      <td className="muted" style={{ fontSize: 12 }}>{fmtDate(m.created_at)}</td>
      <td style={{ textAlign: "right", position: "relative" }} data-row-menu={m.user_id}>
        <button
          className="ghost"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          disabled={busy || m.is_self}
          title={m.is_self ? t("Vous ne pouvez pas modifier votre propre rôle.") : ""}
          style={{ padding: "4px 10px" }}
        >
          ⋯
        </button>
        {menuOpen && !m.is_self && (
          <div
            style={{
              position: "absolute",
              right: 8,
              top: "100%",
              marginTop: 4,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 4,
              minWidth: 180,
              zIndex: 20,
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              textAlign: "left",
            }}
          >
            <button
              className="ghost"
              onClick={() => {
                setEditingRole(true);
                setMenuOpen(false);
                setNewRole(m.role);
              }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: "none", background: "transparent" }}
            >
              {t("Changer le rôle")}
            </button>
            <button
              className="ghost"
              onClick={toggleActive}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                border: "none",
                background: "transparent",
                color: m.status === "active" ? "var(--bad)" : "var(--good)",
              }}
            >
              {m.status === "active" ? t("Désactiver") : t("Réactiver")}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function PendingSection({
  rows,
  onChanged,
  onToast,
}: {
  rows: PendingInvitation[];
  onChanged: () => void;
  onToast: (k: "ok" | "err", m: string) => void;
}) {
  const t = useT();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      onToast("ok", t("Lien copié dans le presse-papiers."));
    } catch {
      onToast("err", t("Impossible de copier le lien."));
    }
  }

  async function revoke(id: string) {
    if (!window.confirm(t("Révoquer cette invitation ?"))) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/team/invites/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      onToast("ok", t("Invitation révoquée."));
      onChanged();
    } catch (e) {
      onToast("err", e instanceof Error ? e.message : "error");
    } finally {
      setBusyId(null);
    }
  }

  async function resend(id: string) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/team/invites/${id}?action=resend`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      onToast("ok", t("Nouveau lien généré."));
      onChanged();
    } catch (e) {
      onToast("err", e instanceof Error ? e.message : "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
        <strong>{t("Invitations en attente")}</strong>
        <span className="muted" style={{ fontSize: 12 }}>({rows.length})</span>
      </div>
      <table className="list" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>{t("Email")}</th>
            <th>{t("Rôle")}</th>
            <th>{t("Expire")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const roleInfo = ROLE_LABEL[r.role] ?? { label: r.role, tone: "var(--muted)" };
            const d = daysUntil(r.expires_at);
            return (
              <tr key={r.id}>
                <td>{r.email}</td>
                <td>
                  <span className="tag" style={{ color: roleInfo.tone, borderColor: roleInfo.tone }}>
                    {t(roleInfo.label)}
                  </span>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {t("Expire dans")} {d}{t("j")}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button
                    className="ghost"
                    onClick={() => copy(r.accept_url)}
                    style={{ padding: "4px 10px", marginRight: 6 }}
                    disabled={busyId === r.id}
                  >
                    {t("Copier le lien")}
                  </button>
                  <button
                    className="ghost"
                    onClick={() => resend(r.id)}
                    style={{ padding: "4px 10px", marginRight: 6 }}
                    disabled={busyId === r.id}
                  >
                    {t("Renvoyer")}
                  </button>
                  <button
                    className="ghost"
                    onClick={() => revoke(r.id)}
                    style={{ padding: "4px 10px", color: "var(--bad)", borderColor: "var(--bad)" }}
                    disabled={busyId === r.id}
                  >
                    {t("Révoquer")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InviteModal({
  onClose,
  onSent,
  onToast,
}: {
  onClose: () => void;
  onSent: () => void;
  onToast: (k: "ok" | "err", m: string) => void;
}) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>("agent");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/team/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), role }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && j.accept_url) {
        // Existing pending invitation: show its URL.
        setCreatedUrl(j.accept_url);
        onSent();
        return;
      }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setCreatedUrl(j.accept_url);
      onSent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      onToast("ok", t("Lien copié dans le presse-papiers."));
    } catch {
      onToast("err", t("Impossible de copier le lien."));
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "min(480px, 100%)", display: "grid", gap: 14 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{t("Inviter un utilisateur")}</h3>
          <button className="ghost" onClick={onClose} style={{ padding: "2px 8px" }}>×</button>
        </div>

        {!createdUrl ? (
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <div>
              <label>{t("Email")}</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nom@exemple.com"
                autoFocus
              />
            </div>
            <div>
              <label>{t("Rôle")}</label>
              <select value={role} onChange={(e) => setRole(e.target.value as (typeof INVITE_ROLES)[number])}>
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(ROLE_LABEL[r]?.label ?? r)}
                  </option>
                ))}
              </select>
            </div>
            {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="ghost" onClick={onClose} disabled={busy}>
                {t("Annuler")}
              </button>
              <button type="submit" disabled={busy || !email}>
                {busy ? t("Envoi…") : t("Envoyer l'invitation")}
              </button>
            </div>
          </form>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="tag good" style={{ width: "fit-content" }}>
              {t("Invitation créée")}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {t("Aucun email automatique pour l'instant — partage le lien à la personne.")}
            </p>
            <div
              style={{
                padding: "8px 10px",
                background: "var(--bg-2)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                wordBreak: "break-all",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {createdUrl}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="ghost" onClick={onClose}>
                {t("Fermer")}
              </button>
              <button type="button" onClick={copy}>
                {t("Copier le lien")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
