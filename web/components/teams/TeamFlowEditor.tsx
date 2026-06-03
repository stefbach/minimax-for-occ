"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * TeamFlowEditor — the visual handoff editor a non-technical operator
 * uses to design the Charlotte → Isabelle → Victoria journey (or any
 * sequence) without touching prompts.
 *
 * What's shown:
 *   • One card per team member, in priority order (1st = lead).
 *   • Between each card, an editable "transfer when…" arrow whose text
 *     describes the condition that hands off to the next member.
 *   • A header on the lead card explicitly labels them as "1er appel".
 *   • Inline edit of `specialty` (machine key the LLM uses) and
 *     `transfer_description` (the human sentence injected into the
 *     prompt as "Transfer to <Next>: <condition>").
 *
 * What's NOT here (kept simple for now):
 *   • No drag-to-reorder. Use the priority number field to reorder.
 *   • No branching logic (if/else). Conditions chain linearly. That
 *     matches every voice journey we've seen so far.
 */

export interface AgentOption {
  id: string;
  name: string;
  description: string | null;
}

export interface TeamMemberRow {
  id: string;
  agent_id: string;
  specialty: string | null;
  transfer_description: string | null;
  priority: number;
  agent: { id: string; name: string; description: string | null } | null;
}

interface Props {
  teamId: string;
  teamName: string;
  leadAgentId: string | null;
  initialMembers: TeamMemberRow[];
  availableAgents: AgentOption[];
}

export function TeamFlowEditor({
  teamId,
  leadAgentId,
  initialMembers,
  availableAgents,
}: Props) {
  const [members, setMembers] = useState<TeamMemberRow[]>(initialMembers);
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline edit drafts: keyed by member.id
  const [drafts, setDrafts] = useState<Record<string, { specialty: string; transfer_description: string }>>(
    () => {
      const d: Record<string, { specialty: string; transfer_description: string }> = {};
      for (const m of initialMembers) {
        d[m.id] = {
          specialty: m.specialty ?? "",
          transfer_description: m.transfer_description ?? "",
        };
      }
      return d;
    },
  );

  // Add-member draft
  const [newAgentId, setNewAgentId] = useState<string>("");
  const [newSpecialty, setNewSpecialty] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const usedAgentIds = new Set(members.map((m) => m.agent_id));
  const addCandidates = availableAgents.filter((a) => !usedAgentIds.has(a.id));

  async function saveMember(memberId: string) {
    const draft = drafts[memberId];
    if (!draft) return;
    setBusyMember(memberId);
    setError(null);
    try {
      const r = await fetch(`/api/teams/${teamId}/members`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          member_id: memberId,
          specialty: draft.specialty.trim() || null,
          transfer_description: draft.transfer_description.trim() || null,
        }),
      });
      const body = await r.json();
      if (!r.ok) {
        setError(body.error ?? `Échec sauvegarde (${r.status})`);
        return;
      }
      setMembers((prev) => prev.map((m) => (m.id === memberId ? (body as TeamMemberRow) : m)));
    } finally {
      setBusyMember(null);
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm("Retirer cet agent du parcours ?")) return;
    setBusyMember(memberId);
    setError(null);
    try {
      const r = await fetch(`/api/teams/${teamId}/members?member_id=${memberId}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body.error ?? `Échec suppression (${r.status})`);
        return;
      }
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } finally {
      setBusyMember(null);
    }
  }

  async function addMember() {
    if (!newAgentId) {
      setError("Choisissez un agent à ajouter.");
      return;
    }
    setError(null);
    const nextPriority = members.length > 0 ? Math.max(...members.map((m) => m.priority)) + 1 : 1;
    const r = await fetch(`/api/teams/${teamId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: newAgentId,
        specialty: newSpecialty.trim() || null,
        transfer_description: newDescription.trim() || null,
        priority: nextPriority,
      }),
    });
    const body = await r.json();
    if (!r.ok) {
      setError(body.error ?? `Échec ajout (${r.status})`);
      return;
    }
    setMembers((prev) => [...prev, body as TeamMemberRow]);
    setDrafts((d) => ({
      ...d,
      [body.id]: {
        specialty: body.specialty ?? "",
        transfer_description: body.transfer_description ?? "",
      },
    }));
    setNewAgentId("");
    setNewSpecialty("");
    setNewDescription("");
    setShowAdd(false);
  }

  function isDirty(m: TeamMemberRow): boolean {
    const d = drafts[m.id];
    if (!d) return false;
    return (
      d.specialty !== (m.specialty ?? "") ||
      d.transfer_description !== (m.transfer_description ?? "")
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ background: "var(--bg-2)", padding: "10px 14px", fontSize: 13, color: "var(--muted)" }}>
        💡 Le parcours s&apos;exécute dans l&apos;ordre indiqué. <strong>Le 1er agent répond à
        l&apos;appel</strong>. Chaque flèche décrit la condition qui déclenche le passage
        à l&apos;agent suivant. La condition est <strong>injectée mot-pour-mot</strong> dans
        le prompt de l&apos;agent, donc utilisez des phrases claires en anglais (ou la
        langue de l&apos;agent).
      </div>

      {error && (
        <div className="card" style={{ background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.3)", color: "#ff8080" }}>
          {error}
        </div>
      )}

      {members.length === 0 ? (
        <div className="card">
          <h3>Aucun agent dans cette équipe</h3>
          <p className="muted">Ajoutez Charlotte (ou un autre agent) comme premier intervenant.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 0 }}>
          {members.map((m, i) => {
            const isLead = m.agent_id === leadAgentId || i === 0;
            const isLast = i === members.length - 1;
            const draft = drafts[m.id] ?? { specialty: "", transfer_description: "" };
            const dirty = isDirty(m);
            return (
              <div key={m.id} style={{ display: "grid", gap: 0 }}>
                {/* Agent card */}
                <div
                  className="card"
                  style={{
                    display: "grid",
                    gap: 10,
                    borderLeft: isLead ? "4px solid var(--accent)" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div>
                      <h3 style={{ margin: 0 }}>
                        {m.agent?.name ?? "Agent inconnu"}
                        {isLead && <span className="tag good" style={{ marginLeft: 8 }}>1er appel</span>}
                      </h3>
                      {m.agent?.description && (
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                          {m.agent.description}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {m.agent?.id && (
                        <Link href={`/agents/${m.agent.id}/edit`}>
                          <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }}>
                            Éditer l&apos;agent
                          </button>
                        </Link>
                      )}
                      <button
                        className="ghost"
                        onClick={() => removeMember(m.id)}
                        disabled={busyMember === m.id}
                        style={{ padding: "4px 10px", fontSize: 12, color: "#ff8080" }}
                        title="Retirer du parcours (l'agent lui-même n'est pas supprimé)"
                      >
                        Retirer
                      </button>
                    </div>
                  </div>

                  {!isLast && (
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 200px) 1fr", gap: 8, alignItems: "start" }}>
                      <div>
                        <label style={{ fontSize: 12, color: "var(--muted)" }}>Clé technique (LLM)</label>
                        <input
                          value={draft.specialty}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [m.id]: { ...d[m.id], specialty: e.target.value.toLowerCase().replace(/\s+/g, "_") },
                            }))
                          }
                          placeholder="clinical_screening"
                          style={{ fontFamily: "monospace", fontSize: 13 }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: "var(--muted)" }}>
                          Description du transfert (utilisée par le prochain agent pour comprendre ce qu&apos;il fait)
                        </label>
                        <input
                          value={draft.transfer_description}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [m.id]: { ...d[m.id], transfer_description: e.target.value },
                            }))
                          }
                          placeholder="ex: Clinical assistant – collects BMI and runs eligibility."
                        />
                      </div>
                    </div>
                  )}

                  {!isLast && dirty && (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => saveMember(m.id)} disabled={busyMember === m.id}>
                        {busyMember === m.id ? "Sauvegarde…" : "Sauvegarder"}
                      </button>
                      <button
                        className="ghost"
                        onClick={() =>
                          setDrafts((d) => ({
                            ...d,
                            [m.id]: {
                              specialty: m.specialty ?? "",
                              transfer_description: m.transfer_description ?? "",
                            },
                          }))
                        }
                      >
                        Annuler
                      </button>
                    </div>
                  )}
                </div>

                {/* Arrow + condition between agents */}
                {!isLast && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      padding: "8px 0",
                      gap: 4,
                    }}
                  >
                    <div style={{ fontSize: 24, color: "var(--muted)", lineHeight: 1 }}>↓</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        textAlign: "center",
                        fontStyle: "italic",
                        maxWidth: 480,
                      }}
                    >
                      transfère vers <strong>{members[i + 1]?.agent?.name ?? "?"}</strong> quand{" "}
                      <em>« {m.transfer_description || "…à définir…"} »</em>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add agent block */}
      {showAdd ? (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Ajouter un agent au parcours</h3>
          <div>
            <label>Agent</label>
            <select value={newAgentId} onChange={(e) => setNewAgentId(e.target.value)}>
              <option value="">— choisir —</option>
              {addCandidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.description ? ` — ${a.description.slice(0, 60)}` : ""}
                </option>
              ))}
            </select>
            {addCandidates.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Tous vos agents sont déjà dans le parcours.{" "}
                <Link href="/agents/new">Créer un nouvel agent</Link>.
              </div>
            )}
          </div>
          <div className="form-row">
            <div>
              <label>Clé technique</label>
              <input
                value={newSpecialty}
                onChange={(e) => setNewSpecialty(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                placeholder="patient_intake"
                style={{ fontFamily: "monospace", fontSize: 13 }}
              />
            </div>
            <div>
              <label>Description du transfert</label>
              <input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="ex: Patient coordinator – collects admin + booking."
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={addMember}>Ajouter</button>
            <button className="ghost" onClick={() => setShowAdd(false)}>Annuler</button>
          </div>
        </div>
      ) : (
        <button
          className="ghost"
          onClick={() => setShowAdd(true)}
          disabled={addCandidates.length === 0}
          style={{ justifySelf: "start" }}
        >
          + Ajouter un agent au parcours
        </button>
      )}
    </div>
  );
}
