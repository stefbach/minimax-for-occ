"use client";

import { useEffect, useState } from "react";

type ScriptOption = { id: string; name: string; mission: string | null };

/**
 * "Make outbound call" modal — Retell-style shortcut. Lets the user dial
 * ONE phone number with ONE AI agent on the spot, without creating a
 * campaign + target row. Bound to a specific agent_id at mount time
 * (page-level button in AgentSession) — for the agent-agnostic version
 * see /outbound-call/page.tsx which picks the agent in the form.
 */
export function OutboundCallModal({
  agentId,
  agentName,
  onClose,
}: {
  agentId: string;
  agentName: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState("");
  const [firstname, setFirstname] = useState("");
  const [lastname, setLastname] = useState("");
  const [scriptId, setScriptId] = useState("");
  const [scripts, setScripts] = useState<ScriptOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load scripts for the org so the user can pick one to follow during the
  // call. Without a script, the agent improvises from its system_prompt
  // alone, which gives variable openings (Wati 16/06 — Charlotte n'a pas
  // suivi son flow habituel "Hi {{firstname}}, this is Charlotte from OCC"
  // car aucun script_id n'etait passe). Auto-select the script whose name
  // mentions the agent (e.g. "OCC – Charlotte: …" when launching from
  // Charlotte/Charlotte - teste).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/scripts")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: unknown) => {
        if (cancelled) return;
        const list: ScriptOption[] = Array.isArray(rows)
          ? rows
              .map((r) => r as Record<string, unknown>)
              .map((r) => ({
                id: String(r.id ?? ""),
                name: String(r.name ?? ""),
                mission: (r.mission as string | null) ?? null,
              }))
              .filter((s) => s.id)
          : [];
        setScripts(list);
        // Auto-pick the script dedicated to THIS agent. Strip "- teste"
        // suffix first, then prefer "<name>:" (e.g. "Charlotte:") over
        // "<name> →" (e.g. "Charlotte → Isabelle → Victoria") — the
        // multi-agent parcours overlaps too much with all three test
        // agents and confuses the LLM (Wati 16/06).
        const base = agentName.replace(/-?\s*teste?\s*$/i, "").trim().toLowerCase();
        if (base) {
          const lower = (s: ScriptOption) => s.name.toLowerCase();
          const dedicated = list.find((s) =>
            new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "i").test(lower(s)),
          );
          if (dedicated) {
            setScriptId(dedicated.id);
          } else {
            const loose = list.find((s) => lower(s).includes(base));
            if (loose) setScriptId(loose.id);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agentName]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

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

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "min(480px, 92vw)", maxHeight: "90vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>☎ Appel sortant via {agentName}</h3>
          <button className="ghost" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
          L&apos;agent appelle ce numéro immédiatement. Pas besoin de créer une
          campagne ni un target.
        </p>

        <form onSubmit={submit} style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
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
              autoFocus
              disabled={busy}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Prénom</span>
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
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Nom</span>
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
            Utilisés pour remplacer <code>{"{{firstname}}"}</code> /{" "}
            <code>{"{{lastname}}"}</code> dans le greeting et le system prompt.
          </p>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              Script à suivre (optionnel)
            </span>
            <select
              value={scriptId}
              onChange={(e) => setScriptId(e.target.value)}
              disabled={busy}
              style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
            >
              <option value="">— Aucun script (l&apos;agent improvise) —</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              Sans script, l&apos;agent suit uniquement son system prompt et peut
              improviser l&apos;ouverture. Avec script, il suit le déroulé étape
              par étape (présentation, qualification, transfert).
            </span>
          </label>

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

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button type="button" className="ghost" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" disabled={busy || !to.trim()}>
              {busy ? "Lancement…" : "Lancer l'appel"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
