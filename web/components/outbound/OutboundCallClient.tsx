"use client";

import { useState } from "react";

type AgentOption = { id: string; name: string; voice: string | null };
type ScriptOption = { id: string; name: string };

/**
 * Form for /outbound-call. Posts to POST /api/outbound-call, same backend
 * as the per-agent OutboundCallModal in AgentSession — the only
 * difference is that this version lets the operator pick the agent and
 * (optionally) a Script from a dropdown.
 *
 * Team IA / handoff chain : pas exposé ici parce qu'aujourd'hui le
 * multi-agent handoff est dérivé du Script (le worker lit script.steps
 * et fait le routing). Si on ajoute plus tard un sélecteur "Team",
 * passer `team_id` dans le POST body et l'utiliser côté worker.
 * TODO Wati : team selector si on garde un "Team" first-class hors script.
 */
export function OutboundCallClient({
  agents,
  scripts,
}: {
  agents: AgentOption[];
  scripts: ScriptOption[];
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [to, setTo] = useState("");
  const [firstname, setFirstname] = useState("");
  const [lastname, setLastname] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!agentId) {
      setError("Sélectionne un agent IA.");
      return;
    }
    const trimmed = to.trim();
    if (!/^\+\d{6,15}$/.test(trimmed)) {
      setError("Le numéro doit être au format E.164 (ex. +33756123456).");
      return;
    }

    setBusy(true);
    try {
      const r = await fetch("/api/outbound-call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          to_e164: trimmed,
          firstname: firstname.trim() || undefined,
          lastname: lastname.trim() || undefined,
          script_id: scriptId || undefined,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        call_id?: string;
        error?: string;
      };
      if (!r.ok) {
        setError(data.error ?? `HTTP ${r.status}`);
        return;
      }
      setSuccess(`Appel lancé. ID : ${data.call_id ?? "—"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (agents.length === 0) {
    return (
      <section className="card">
        <p className="muted">
          Aucun agent IA n&apos;est configuré dans cette organisation. Créez-en
          un dans la page <a href="/agents">Agents</a> avant de lancer un
          appel.
        </p>
      </section>
    );
  }

  return (
    <section className="card" style={{ maxWidth: 640 }}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Agent IA <span style={{ color: "var(--bad)" }}>*</span>
          </span>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={busy}
            required
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.voice ? ` — voix: ${a.voice}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            Numéro à appeler (E.164) <span style={{ color: "var(--bad)" }}>*</span>
          </span>
          <input
            type="tel"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="+33756123456"
            required
            disabled={busy}
            style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Prénom du destinataire</span>
            <input
              type="text"
              value={firstname}
              onChange={(e) => setFirstname(e.target.value)}
              placeholder="(optionnel)"
              disabled={busy}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Nom du destinataire</span>
            <input
              type="text"
              value={lastname}
              onChange={(e) => setLastname(e.target.value)}
              placeholder="(optionnel)"
              disabled={busy}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
            />
          </label>
        </div>
        <p className="muted" style={{ fontSize: 11, margin: 0 }}>
          Substitués dans le greeting et le system prompt en place de{" "}
          <code>{"{{firstname}}"}</code> / <code>{"{{lastname}}"}</code>.
        </p>

        {scripts.length > 0 && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Script à dérouler (optionnel)
            </span>
            <select
              value={scriptId}
              onChange={(e) => setScriptId(e.target.value)}
              disabled={busy}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
            >
              <option value="">— Aucun script (system prompt brut)</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <div style={{ color: "var(--bad)", fontSize: 13 }} role="alert">
            {error}
          </div>
        )}
        {success && (
          <div style={{ color: "var(--good)", fontSize: 13 }} role="status">
            {success}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="submit" disabled={busy || !to.trim() || !agentId}>
            {busy ? "Lancement…" : "☎ Lancer l'appel"}
          </button>
        </div>
      </form>
    </section>
  );
}
