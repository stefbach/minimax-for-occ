"use client";

import { useEffect, useState } from "react";
import type { TeamMember, TeamMembersResponse } from "@/app/api/team/members/route";

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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function TeamList() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/team/members", { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as TeamMembersResponse | { error?: string };
        if (!r.ok) throw new Error(("error" in j && j.error) || `HTTP ${r.status}`);
        if (alive) setMembers((j as TeamMembersResponse).members ?? []);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "error"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <div className="card"><p className="muted" style={{ margin: 0 }}>Chargement…</p></div>;
  if (error) return <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>;
  if (members.length === 0)
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>Aucun membre — ajoutez-en via le bouton Inviter.</p>
      </div>
    );

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="list" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Membre</th>
            <th>Rôle</th>
            <th>Statut</th>
            <th>Ajouté le</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const roleInfo = ROLE_LABEL[m.role] ?? { label: m.role, tone: "var(--muted)" };
            return (
              <tr key={m.user_id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{m.display_name || m.email || "—"}</div>
                  {m.email && m.display_name && (
                    <div className="muted" style={{ fontSize: 12 }}>{m.email}</div>
                  )}
                </td>
                <td>
                  <span className="tag" style={{ color: roleInfo.tone, borderColor: roleInfo.tone }}>
                    {roleInfo.label}
                  </span>
                </td>
                <td>
                  <span className={`tag ${m.status === "active" ? "good" : ""}`} style={m.status === "disabled" ? { color: "var(--muted)" } : {}}>
                    {m.status === "active" ? "Actif" : "Désactivé"}
                  </span>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{fmtDate(m.created_at)}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="ghost" disabled title="Édition à venir" style={{ padding: "4px 10px" }}>⋯</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
