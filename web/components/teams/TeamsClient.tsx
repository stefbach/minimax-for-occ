"use client";

import { Fragment, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

export interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  lead_agent_id: string | null;
  created_at: string;
}

export interface AgentOption {
  id: string;
  name: string;
  description: string | null;
}

interface TeamMember {
  id: string;
  agent_id: string;
  specialty: string | null;
  transfer_description: string | null;
  priority: number;
  agent: { id: string; name: string; description: string | null } | null;
}

export function TeamsClient({ initial, agents }: { initial: TeamRow[]; agents: AgentOption[] }) {
  const tr = useT();
  const [teams, setTeams] = useState<TeamRow[]>(initial);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, TeamMember[]>>({});

  // Create-team form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leadAgentId, setLeadAgentId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-member draft per team
  const [draft, setDraft] = useState<Record<string, { agent_id: string; specialty: string; transfer_description: string; priority: number }>>({});

  async function refresh() {
    const r = await fetch("/api/teams");
    if (r.ok) setTeams(await r.json());
  }

  async function refreshMembers(teamId: string) {
    const r = await fetch(`/api/teams/${teamId}/members`);
    if (!r.ok) return;
    const data = (await r.json()) as TeamMember[];
    setMembers((m) => ({ ...m, [teamId]: data }));
  }

  useEffect(() => {
    if (expanded) refreshMembers(expanded);
  }, [expanded]);

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        description: description || null,
        lead_agent_id: leadAgentId || null,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Erreur");
      return;
    }
    setName("");
    setDescription("");
    setLeadAgentId("");
    refresh();
  }

  async function deleteTeam(id: string) {
    if (!confirm(tr("Supprimer cette team et tous ses membres ?"))) return;
    await fetch(`/api/teams/${id}`, { method: "DELETE" });
    refresh();
    if (expanded === id) setExpanded(null);
  }

  function getDraft(teamId: string) {
    return draft[teamId] ?? { agent_id: "", specialty: "", transfer_description: "", priority: 1 };
  }

  function setDraftField(teamId: string, field: keyof ReturnType<typeof getDraft>, value: string | number) {
    setDraft((d) => ({
      ...d,
      [teamId]: { ...getDraft(teamId), [field]: value },
    }));
  }

  async function addMember(teamId: string) {
    const d = getDraft(teamId);
    if (!d.agent_id) return;
    const r = await fetch(`/api/teams/${teamId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: d.agent_id,
        specialty: d.specialty || null,
        transfer_description: d.transfer_description || null,
        priority: d.priority || 1,
      }),
    });
    if (r.ok) {
      setDraft((s) => ({ ...s, [teamId]: { agent_id: "", specialty: "", transfer_description: "", priority: 1 } }));
      refreshMembers(teamId);
    }
  }

  async function removeMember(teamId: string, memberId: string) {
    await fetch(`/api/teams/${teamId}/members?member_id=${memberId}`, { method: "DELETE" });
    refreshMembers(teamId);
  }

  async function setLead(teamId: string, leadId: string) {
    await fetch(`/api/teams/${teamId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lead_agent_id: leadId || null }),
    });
    refresh();
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{tr("Créer une team")}</h3>
        <form onSubmit={createTeam} style={{ display: "grid", gap: 10 }}>
          <div className="form-row">
            <div>
              <label>{tr("Nom")}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Concierge digital · multi-spécialistes" required />
            </div>
            <div>
              <label>{tr("Agent lead (router)")}</label>
              <select value={leadAgentId} onChange={(e) => setLeadAgentId(e.target.value)}>
                <option value="">{tr("— aucun (premier membre ajouté servira) —")}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label>{tr("Description")}</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: facturation, support technique, ventes" />
          </div>
          {error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>}
          <div>
            <button type="submit" disabled={busy || !name}>{busy ? "…" : tr("Créer la team")}</button>
          </div>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {teams.length === 0 ? (
          <div style={{ padding: 20, display: "grid", gap: 10 }}>
            <div style={{ color: "var(--muted)" }}>Aucune team pour l&apos;instant.</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 560 }}>
              Une <em>team</em> est un groupe d&apos;agents IA orchestrés par un agent lead.
              Le lead route les conversations vers le bon spécialiste via le tool
              <code> transfer_to_specialist</code>. Utilisez le formulaire ci-dessus
              pour créer votre première team.
            </div>
            <div>
              <button
                onClick={() => {
                  const el = document.querySelector<HTMLInputElement>("input[placeholder^=\"Concierge digital\"]");
                  el?.focus();
                }}
              >
                {tr("+ Créer une team")}
              </button>
            </div>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>{tr("Nom")}</th>
                <th>{tr("Lead")}</th>
                <th>{tr("Description")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const lead = agents.find((a) => a.id === team.lead_agent_id);
                const ms = members[team.id] ?? [];
                const d = getDraft(team.id);
                return (
                  <Fragment key={team.id}>
                    <tr>
                      <td>
                        <button
                          className="ghost"
                          style={{ padding: "4px 8px", marginRight: 8 }}
                          onClick={() => setExpanded(expanded === team.id ? null : team.id)}
                          title="Voir / éditer les membres"
                          aria-label={expanded === team.id ? `Réduire la team ${team.name}` : `Voir les membres de ${team.name}`}
                          aria-expanded={expanded === team.id}
                        >
                          <span aria-hidden="true">{expanded === team.id ? "▾" : "▸"}</span>
                        </button>
                        <strong>{team.name}</strong>
                      </td>
                      <td>{lead ? <span className="tag">{lead.name}</span> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                      <td style={{ color: "var(--muted)", fontSize: 13 }}>{team.description ?? "—"}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <a
                          href={`/teams/${team.id}`}
                          style={{ marginRight: 8, color: "var(--accent-2)", fontWeight: 600, textDecoration: "none" }}
                        >
                          {tr("Voir le parcours →")}
                        </a>
                        <button className="danger" style={{ padding: "5px 9px" }} onClick={() => deleteTeam(team.id)}>{tr("Supprimer")}</button>
                      </td>
                    </tr>
                    {expanded === team.id && (
                      <tr>
                        <td colSpan={4} style={{ background: "var(--bg-2)", padding: 14 }}>
                          <div style={{ display: "grid", gap: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <label style={{ fontSize: 12, color: "var(--muted)" }}>Lead :</label>
                              <select
                                value={team.lead_agent_id ?? ""}
                                onChange={(e) => setLead(team.id, e.target.value)}
                                style={{ minWidth: 220 }}
                              >
                                <option value="">{tr("— aucun —")}</option>
                                {agents.map((a) => (
                                  <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                              </select>
                            </div>

                            <div style={{ fontSize: 12, color: "var(--muted)" }}>
                              Membres (specialty + description sont visibles du LLM pour le tool <code>transfer_to_specialist</code>)
                            </div>

                            {ms.length === 0 ? (
                              <div style={{ color: "var(--muted)", fontSize: 13 }}>{tr("Aucun spécialiste ajouté.")}</div>
                            ) : (
                              <div style={{ display: "grid", gap: 6 }}>
                                {ms.map((m) => (
                                  <div
                                    key={m.id}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "1fr 160px 2fr 60px auto",
                                      gap: 10,
                                      alignItems: "center",
                                      background: "var(--panel)",
                                      padding: "8px 12px",
                                      borderRadius: 8,
                                      border: "1px solid var(--border)",
                                    }}
                                  >
                                    <div>
                                      <strong>{m.agent?.name ?? "—"}</strong>
                                      {m.agent?.description && (
                                        <div style={{ color: "var(--muted)", fontSize: 11 }}>{m.agent.description}</div>
                                      )}
                                    </div>
                                    <span className="tag">{m.specialty ?? "—"}</span>
                                    <span style={{ color: "var(--muted)", fontSize: 12 }}>
                                      {m.transfer_description ?? <em>{tr("(aucune description)")}</em>}
                                    </span>
                                    <span style={{ color: "var(--muted)", fontSize: 12 }}>p{m.priority}</span>
                                    <button className="danger" style={{ padding: "4px 8px" }} onClick={() => removeMember(team.id, m.id)}>
                                      {tr("Retirer")}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 2fr 80px auto", gap: 8, alignItems: "end" }}>
                              <div>
<label style={{ fontSize: 11 }}>{tr("Agent")}</label>
                                <select
                                  value={d.agent_id}
                                  onChange={(e) => setDraftField(team.id, "agent_id", e.target.value)}
                                >
                                  <option value="">— choisir —</option>
                                  {agents
                                    .filter((a) => !ms.some((m) => m.agent_id === a.id))
                                    .map((a) => (
                                      <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                </select>
                              </div>
                              <div>
                                <label style={{ fontSize: 11 }}>Specialty</label>
                                <input
                                  value={d.specialty}
                                  placeholder="billing, tech_support, sales…"
                                  onChange={(e) => setDraftField(team.id, "specialty", e.target.value)}
                                />
                              </div>
                              <div>
<label style={{ fontSize: 11 }}>{tr("Description visible au LLM")}</label>
                                <input
                                  value={d.transfer_description}
                                  placeholder="Transfère ici pour les questions de facturation…"
                                  onChange={(e) => setDraftField(team.id, "transfer_description", e.target.value)}
                                />
                              </div>
                              <div>
<label style={{ fontSize: 11 }}>{tr("Priorité")}</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={99}
                                  value={d.priority}
                                  onChange={(e) => setDraftField(team.id, "priority", Number(e.target.value) || 1)}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => addMember(team.id)}
                                disabled={!d.agent_id}
                                title={!d.agent_id ? tr("Sélectionnez d'abord un agent") : tr("Ajouter ce spécialiste à la team")}
                              >
                                {tr("+ Ajouter")}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
