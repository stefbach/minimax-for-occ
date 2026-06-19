"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

export interface QueueRow {
  id: string;
  name: string;
  description: string | null;
  strategy: "longest_idle" | "round_robin" | "broadcast";
  max_wait_secs: number | null;
  fallback_voicemail: boolean;
  created_at: string;
}

export interface AgentHandleOption {
  id: string;
  kind: "ai" | "human";
  display_name: string;
  active: boolean;
}

interface QueueMember {
  id: string;
  priority: number;
  agent_handle: AgentHandleOption | null;
}

export function QueuesClient({ initial, handles }: { initial: QueueRow[]; handles: AgentHandleOption[] }) {
  const t = useT();
  const [queues, setQueues] = useState<QueueRow[]>(initial);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, QueueMember[]>>({});

  // Create form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [strategy, setStrategy] = useState<QueueRow["strategy"]>("longest_idle");
  const [maxWait, setMaxWait] = useState(600);
  const [fallbackVm, setFallbackVm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/queues");
    if (r.ok) setQueues(await r.json());
  }

  async function refreshMembers(queueId: string) {
    const r = await fetch(`/api/queues/${queueId}/members`);
    if (!r.ok) return;
    const data = (await r.json()) as QueueMember[];
    setMembers((m) => ({ ...m, [queueId]: data }));
  }

  useEffect(() => {
    if (expanded) refreshMembers(expanded);
  }, [expanded]);

  async function createQueue(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/queues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        description: description || null,
        strategy,
        max_wait_secs: maxWait,
        fallback_voicemail: fallbackVm,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Erreur");
      return;
    }
    setName(""); setDescription("");
    refresh();
  }

  async function delQueue(id: string) {
    if (!confirm(t("Supprimer cette file et tous ses membres ?"))) return;
    await fetch(`/api/queues/${id}`, { method: "DELETE" });
    refresh();
    if (expanded === id) setExpanded(null);
  }

  async function addMember(queueId: string, handleId: string) {
    if (!handleId) return;
    await fetch(`/api/queues/${queueId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_handle_id: handleId }),
    });
    refreshMembers(queueId);
  }

  async function removeMember(queueId: string, membershipId: string) {
    await fetch(`/api/queues/${queueId}/members?membership_id=${membershipId}`, { method: "DELETE" });
    refreshMembers(queueId);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Créer une file")}</h3>
        <form onSubmit={createQueue} style={{ display: "grid", gap: 10 }}>
          <div className="form-row">
            <div>
              <label>Nom</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Conciergerie · niveau 1" required />
            </div>
            <div>
              <label>Stratégie de routage</label>
              <select value={strategy} onChange={(e) => setStrategy(e.target.value as QueueRow["strategy"])}>
                <option value="longest_idle">longest_idle (agent libre depuis le plus longtemps)</option>
                <option value="round_robin">round_robin (rotation)</option>
                <option value="broadcast">broadcast (sonne tous en même temps)</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: appels chambre client" />
            </div>
            <div>
              <label>Attente max (secondes)</label>
              <input type="number" min={30} max={3600} value={maxWait} onChange={(e) => setMaxWait(Number(e.target.value))} />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="checkbox" style={{ width: 18 }} checked={fallbackVm} onChange={(e) => setFallbackVm(e.target.checked)} />
            Basculer en messagerie si dépassement
          </label>
          {error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>}
          <div>
            <button type="submit" disabled={busy || !name}>{busy ? "…" : t("Créer la file")}</button>
          </div>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {queues.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>Aucune file pour l&apos;instant.</div>
        ) : (
          <table className="list">
            <thead><tr><th>Nom</th><th>Stratégie</th><th>Max attente</th><th>Voicemail</th><th></th></tr></thead>
            <tbody>
              {queues.map((q) => (
                <>
                  <tr key={q.id}>
                    <td>
                      <button
                        className="ghost"
                        style={{ padding: "4px 8px", marginRight: 8 }}
                        onClick={() => setExpanded(expanded === q.id ? null : q.id)}
                        title="Voir / éditer les membres"
                        aria-label={expanded === q.id ? `Réduire la file ${q.name}` : `Voir les membres de ${q.name}`}
                        aria-expanded={expanded === q.id}
                      >
                        <span aria-hidden="true">{expanded === q.id ? "▾" : "▸"}</span>
                      </button>
                      <strong>{q.name}</strong>
                      {q.description && <div style={{ color: "var(--muted)", fontSize: 12 }}>{q.description}</div>}
                    </td>
                    <td><span className="tag">{q.strategy}</span></td>
                    <td>{q.max_wait_secs ?? "—"} s</td>
                    <td>{q.fallback_voicemail ? <span className="tag good">oui</span> : <span className="tag">non</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="danger" style={{ padding: "5px 9px" }} onClick={() => delQueue(q.id)}>{t("Supprimer")}</button>
                    </td>
                  </tr>
                  {expanded === q.id && (
                    <tr>
                      <td colSpan={5} style={{ background: "var(--bg-2)", padding: 14 }}>
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>Membres affectés à cette file (priorité ascendante = passe en premier)</div>
                          {(members[q.id] ?? []).length === 0 ? (
                            <div style={{ color: "var(--muted)", fontSize: 13 }}>Aucun agent assigné.</div>
                          ) : (
                            <div style={{ display: "grid", gap: 6 }}>
                              {(members[q.id] ?? []).map((m) => (
                                <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--panel)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
                                  <div>
                                    <span className="tag" style={{ marginRight: 8 }}>{m.agent_handle?.kind}</span>
                                    <strong>{m.agent_handle?.display_name ?? "—"}</strong>
                                    <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>priorité {m.priority}</span>
                                  </div>
                                  <button className="danger" style={{ padding: "4px 8px" }} onClick={() => removeMember(q.id, m.id)}>Retirer</button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8 }}>
                            <select
                              defaultValue=""
                              onChange={(e) => { addMember(q.id, e.target.value); e.target.value = ""; }}
                              style={{ flex: 1 }}
                            >
                              <option value="">+ Ajouter un agent…</option>
                              {handles
                                .filter((h) => !(members[q.id] ?? []).some((m) => m.agent_handle?.id === h.id))
                                .map((h) => (
                                  <option key={h.id} value={h.id}>
                                    [{h.kind}] {h.display_name}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
