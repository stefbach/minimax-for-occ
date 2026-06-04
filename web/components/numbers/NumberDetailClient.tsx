"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";

export interface FlowOption {
  id: string;
  name: string;
}

export interface QueueOption {
  id: string;
  name: string;
}

export interface NumberSummary {
  id: string;
  e164: string;
  label: string | null;
  active: boolean;
  flow_id: string | null;
  queue_id: string | null;
  agent_handle_id: string | null;
}

type Mode = "ai" | "flow" | "queue";

function detectMode(n: NumberSummary): Mode {
  if (n.flow_id) return "flow";
  if (n.queue_id) return "queue";
  return "ai";
}

/**
 * Per-number inbound configuration UI. Three radios — IA / IVR flow / file
 * humaine — that PATCH /api/numbers/[id] with the right (flow_id, queue_id)
 * combo. Selecting one mode clears the others so the backend dispatch
 * (`/api/twilio/voice-inbound`) always has an unambiguous branch to take.
 */
export function NumberDetailClient({
  number,
  flows,
  queues,
}: {
  number: NumberSummary;
  flows: FlowOption[];
  queues: QueueOption[];
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>(detectMode(number));
  const [flowId, setFlowId] = useState<string>(number.flow_id ?? "");
  const [queueId, setQueueId] = useState<string>(number.queue_id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    setNote(null);
    let body: Record<string, string | null> = {};
    if (mode === "ai") {
      body = { flow_id: null, queue_id: null };
    } else if (mode === "flow") {
      if (!flowId) {
        setErr(t("Sélectionnez un flow."));
        setBusy(false);
        return;
      }
      body = { flow_id: flowId, queue_id: null };
    } else {
      if (!queueId) {
        setErr(t("Sélectionnez une file."));
        setBusy(false);
        return;
      }
      body = { flow_id: null, queue_id: queueId };
    }
    try {
      const r = await fetch(`/api/numbers/${number.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setNote(t("Réglages enregistrés."));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      <h3 style={{ margin: 0 }}>{t("Lorsqu'un appel entrant arrive")}</h3>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {t(
          "Choisissez ce qui se passe quand quelqu'un appelle ce numéro. Vous pouvez changer à tout moment — les appels en cours ne sont pas affectés.",
        )}
      </p>

      <div style={{ display: "grid", gap: 10 }}>
        <RadioCard
          checked={mode === "ai"}
          onChange={() => setMode("ai")}
          title={t("Confier à l'IA")}
          desc={t(
            "L'agent IA décroche, conduit la conversation et qualifie l'appel comme pour un appel sortant.",
          )}
        />
        <RadioCard
          checked={mode === "flow"}
          onChange={() => setMode("flow")}
          title={t("Lancer un flow IVR")}
          desc={t("Joue un menu vocal interactif (touche 1, 2, …) défini dans Flows / IVR.")}
        >
          {mode === "flow" && (
            <div style={{ marginTop: 8 }}>
              <select
                value={flowId}
                onChange={(e) => setFlowId(e.target.value)}
                style={{ minWidth: 280 }}
              >
                <option value="">— {t("Sélectionnez un flow")} —</option>
                {flows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              {flows.length === 0 && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {t(
                    "Aucun flow défini. Créez-en un dans Flows / IVR puis revenez ici.",
                  )}
                </div>
              )}
            </div>
          )}
        </RadioCard>
        <RadioCard
          checked={mode === "queue"}
          onChange={() => setMode("queue")}
          title={t("Envoyer en file humaine")}
          desc={t(
            "L'appelant patiente avec une musique ; le premier agent disponible décroche depuis son poste.",
          )}
        >
          {mode === "queue" && (
            <div style={{ marginTop: 8 }}>
              <select
                value={queueId}
                onChange={(e) => setQueueId(e.target.value)}
                style={{ minWidth: 280 }}
              >
                <option value="">— {t("Sélectionnez une file")} —</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </select>
              {queues.length === 0 && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {t(
                    "Aucune file définie. Créez-en une dans Files d'attente puis revenez ici.",
                  )}
                </div>
              )}
            </div>
          )}
        </RadioCard>
      </div>

      {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
      {note && <div className="muted" style={{ fontSize: 13 }}>{note}</div>}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={save} disabled={busy}>
          {busy ? t("Enregistrement…") : t("Enregistrer")}
        </button>
      </div>
    </div>
  );
}

function RadioCard({
  checked,
  onChange,
  title,
  desc,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <label
      className="card"
      style={{
        display: "grid",
        gridTemplateColumns: "20px 1fr",
        gap: 12,
        cursor: "pointer",
        borderColor: checked ? "var(--accent)" : "var(--border)",
        background: checked ? "var(--bg-2)" : "var(--panel)",
        padding: 12,
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        style={{ marginTop: 2 }}
      />
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          {desc}
        </div>
        {children}
      </div>
    </label>
  );
}
