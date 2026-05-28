"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface AgentHandleOption {
  id: string;
  display_name: string;
  llm_model: string | null;
  tts_voice_id: string | null;
}

export interface PhoneNumberOption {
  id: string;
  e164: string;
  label: string | null;
  active: boolean;
}

export interface ContactOption {
  id: string;
  e164: string;
  display_name: string | null;
}

export interface ScriptOption {
  id: string;
  name: string;
  mission: string | null;
  description: string | null;
}

interface Target {
  e164: string;
  name: string | null;
}

const DAYS = [
  { id: 1, label: "Lun" },
  { id: 2, label: "Mar" },
  { id: 3, label: "Mer" },
  { id: 4, label: "Jeu" },
  { id: 5, label: "Ven" },
  { id: 6, label: "Sam" },
  { id: 0, label: "Dim" },
];

const STORAGE_KEY = "axon.campaign.wizard.draft";

function parseCsv(text: string): Target[] {
  const out: Target[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Skip a header row if it obviously is one.
    if (/^e?\.?164.*,/i.test(line) || /phone.*,/i.test(line)) continue;
    const parts = line.split(",").map((s) => s.trim());
    const e164 = parts[0];
    const name = parts[1] || null;
    if (!e164) continue;
    if (!/^\+?[0-9]{6,}$/.test(e164.replace(/\s+/g, ""))) continue;
    const normalized = e164.startsWith("+") ? e164 : `+${e164}`;
    out.push({ e164: normalized.replace(/\s+/g, ""), name });
  }
  return out;
}

export function CampaignWizard({
  agents,
  numbers,
  contacts,
  scripts = [],
}: {
  agents: AgentHandleOption[];
  numbers: PhoneNumberOption[];
  contacts: ContactOption[];
  scripts?: ScriptOption[];
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentHandleId, setAgentHandleId] = useState(agents[0]?.id ?? "");
  const [scriptId, setScriptId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState(numbers[0]?.id ?? "");
  const [callerIdOverride, setCallerIdOverride] = useState("");
  const [csvText, setCsvText] = useState("");
  const [pickedContactIds, setPickedContactIds] = useState<Set<string>>(new Set());
  const [contactSearch, setContactSearch] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState(5);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [retryDelayMin, setRetryDelayMin] = useState(60);
  const [amdEnabled, setAmdEnabled] = useState(true);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [hourStart, setHourStart] = useState("09:00");
  const [hourEnd, setHourEnd] = useState("18:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = agents.find((a) => a.id === agentHandleId) ?? null;
  const selectedNumber = numbers.find((n) => n.id === phoneNumberId) ?? null;

  const csvTargets = useMemo(() => parseCsv(csvText), [csvText]);
  const pickedContacts = useMemo(
    () =>
      contacts
        .filter((c) => pickedContactIds.has(c.id))
        .map((c) => ({ e164: c.e164, name: c.display_name })),
    [contacts, pickedContactIds],
  );

  const targets: Target[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Target[] = [];
    for (const t of [...csvTargets, ...pickedContacts]) {
      if (seen.has(t.e164)) continue;
      seen.add(t.e164);
      out.push(t);
    }
    return out;
  }, [csvTargets, pickedContacts]);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts.slice(0, 50);
    return contacts
      .filter(
        (c) =>
          c.e164.toLowerCase().includes(q) ||
          (c.display_name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [contacts, contactSearch]);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function togglePicked(id: string) {
    setPickedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function persistDraft() {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ name, description, targets }),
      );
    } catch {
      /* ignore quota */
    }
  }

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Le nom est requis.");
      return;
    }
    if (!agentHandleId) {
      setError("Sélectionnez un agent IA.");
      return;
    }
    if (!phoneNumberId && !callerIdOverride) {
      setError("Choisissez un numéro émetteur ou un caller-id.");
      return;
    }
    setSubmitting(true);
    persistDraft();

    const schedule = {
      days,
      hours: { start: hourStart, end: hourEnd },
    };
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          agent_handle_id: agentHandleId,
          script_id: scriptId || null,
          phone_number_id: phoneNumberId || null,
          caller_id_e164: callerIdOverride.trim() || null,
          schedule,
          max_concurrency: maxConcurrency,
          max_attempts: maxAttempts,
          retry_delay_min: retryDelayMin,
          amd_enabled: amdEnabled,
          targets,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      router.push(`/campaigns/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
      {/* 1. Identité */}
      <section className="card">
        <h3>1. Identité</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr" }}>
          <div>
            <label>Nom *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Relance client Q2"
            />
          </div>
          <div>
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Objectif de la campagne, message clé…"
            />
          </div>
        </div>
      </section>

      {/* 2. Agent */}
      <section className="card">
        <h3>2. Agent IA</h3>
        {agents.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Aucun agent IA disponible. Créez-en un depuis la page Agents.
          </p>
        ) : (
          <>
            <label>Handle (agent IA)</label>
            <select value={agentHandleId} onChange={(e) => setAgentHandleId(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.display_name}
                </option>
              ))}
            </select>
            {selectedAgent && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Modèle : <span className="kbd">{selectedAgent.llm_model ?? "—"}</span>
                {" · "}
                Voix : <span className="kbd">{selectedAgent.tts_voice_id ?? "—"}</span>
              </div>
            )}

            {/* Script réutilisable — l'agent garde sa voix/personnalité,
                le script définit l'objectif de conversation pour CETTE campagne. */}
            <div style={{ marginTop: 16 }}>
              <label>Script (optionnel)</label>
              <select value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                <option value="">— Aucun (l&apos;agent suit son prompt par défaut) —</option>
                {scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.mission ? ` — ${s.mission}` : ""}
                  </option>
                ))}
              </select>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {scripts.length === 0 ? (
                  <>Aucun script. Créez-en un depuis la page <span className="kbd">Scripts</span> pour réutiliser le même agent avec différents objectifs de conversation.</>
                ) : scriptId ? (
                  <>{scripts.find((s) => s.id === scriptId)?.description ?? "Ce script guidera la conversation de l'agent pour cette campagne."}</>
                ) : (
                  <>Le même agent (voix + personnalité) peut servir plusieurs campagnes ; le script définit l&apos;objectif propre à celle-ci.</>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* 3. Numéro émetteur */}
      <section className="card">
        <h3>3. Numéro émetteur</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>Numéro Twilio</label>
            <select
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            >
              <option value="">— Aucun —</option>
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.e164} {n.label ? `(${n.label})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Ou caller-id (E.164)</label>
            <input
              value={callerIdOverride}
              onChange={(e) => setCallerIdOverride(e.target.value)}
              placeholder="+33123456789"
            />
          </div>
        </div>
        {selectedNumber && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Sera utilisé comme <span className="kbd">From</span> sur les appels Twilio.
          </div>
        )}
      </section>

      {/* 4. Cibles */}
      <section className="card">
        <h3>4. Cibles</h3>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label>Coller un CSV (e164,nom)</label>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={"+33612345678,Jean Dupont\n+33687654321,Marie Martin"}
              style={{ minHeight: 120, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {csvTargets.length} cible{csvTargets.length === 1 ? "" : "s"} valide{csvTargets.length === 1 ? "" : "s"} détectée{csvTargets.length === 1 ? "" : "s"}.
            </div>
          </div>
          <div>
            <label>… ou importer depuis les contacts existants</label>
            <input
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Filtrer (nom ou numéro)…"
            />
            <div
              style={{
                marginTop: 8,
                maxHeight: 200,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 8,
                background: "var(--bg-2)",
              }}
            >
              {filteredContacts.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>Aucun contact</div>
              ) : (
                filteredContacts.map((c) => (
                  <label
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 0",
                      cursor: "pointer",
                      margin: 0,
                      color: "var(--text)",
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={pickedContactIds.has(c.id)}
                      onChange={() => togglePicked(c.id)}
                    />
                    <span>
                      {c.display_name ?? c.e164}{" "}
                      <span className="muted" style={{ fontSize: 12 }}>{c.e164}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {pickedContactIds.size} contact{pickedContactIds.size === 1 ? "" : "s"} sélectionné{pickedContactIds.size === 1 ? "" : "s"}.
            </div>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            <strong>Total cibles (déduplication par e164) :</strong> {targets.length}
          </div>
        </div>
      </section>

      {/* 5. Planning */}
      <section className="card">
        <h3>5. Planning</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label>Concurrence max</label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(Number(e.target.value) || 1)}
            />
          </div>
          <div>
            <label>Tentatives max</label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value) || 1)}
            />
          </div>
          <div>
            <label>Délai retry (min)</label>
            <input
              type="number"
              min={1}
              max={1440}
              value={retryDelayMin}
              onChange={(e) => setRetryDelayMin(Number(e.target.value) || 1)}
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>
            <input
              type="checkbox"
              checked={amdEnabled}
              onChange={(e) => setAmdEnabled(e.target.checked)}
              style={{ width: "auto", marginRight: 8 }}
            />
            Détection de répondeur (AMD)
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>Jours autorisés</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DAYS.map((d) => {
              const active = days.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  className={active ? "" : "ghost"}
                  onClick={() => toggleDay(d.id)}
                  style={{ padding: "6px 12px" }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div>
            <label>Heure début</label>
            <input
              type="time"
              value={hourStart}
              onChange={(e) => setHourStart(e.target.value)}
            />
          </div>
          <div>
            <label>Heure fin</label>
            <input type="time" value={hourEnd} onChange={(e) => setHourEnd(e.target.value)} />
          </div>
        </div>
      </section>

      {/* 6. Récap */}
      <section className="card">
        <h3>6. Récapitulatif</h3>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", lineHeight: 1.7 }}>
          <li>
            <strong style={{ color: "var(--text)" }}>{name || "(sans nom)"}</strong>
            {description && ` — ${description}`}
          </li>
          <li>Agent : {selectedAgent?.display_name ?? "—"}</li>
          <li>
            Numéro : {selectedNumber?.e164 ?? callerIdOverride ?? "—"}
          </li>
          <li>{targets.length} cible{targets.length === 1 ? "" : "s"}</li>
          <li>
            Concurrence {maxConcurrency} · Retries {maxAttempts} ({retryDelayMin}min) · AMD{" "}
            {amdEnabled ? "on" : "off"}
          </li>
          <li>
            Fenêtre : {days.map((d) => DAYS.find((x) => x.id === d)?.label).join(", ")} · {hourStart}–{hourEnd}
          </li>
        </ul>
        {error && (
          <div style={{ color: "var(--bad)", marginTop: 12, fontSize: 14 }}>{error}</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={submit} disabled={submitting}>
            {submitting ? "Création…" : "Créer en brouillon"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => router.push("/campaigns")}
            disabled={submitting}
          >
            Annuler
          </button>
        </div>
      </section>
    </div>
  );
}
