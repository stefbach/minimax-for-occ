"use client";

import { useMemo, useState } from "react";

/**
 * SimulationLauncher
 *
 * A pre-call form that scans the agent's system prompt + greeting for
 * `{{variable}}` placeholders and lets the operator fill them in before
 * starting a browser-based voice session.
 *
 * Why this exists: testing an agent end-to-end used to mean creating a
 * campaign + a target row + dispatching a real call. With this launcher the
 * tester picks values like `firstname=Sarah` and `bmi=42` and hears the
 * agent talk to "Sarah" immediately — no campaign, no SIP, no waiting.
 *
 * The values are forwarded to /api/token as `vars=<JSON>`, which embeds
 * them in the LiveKit participant attributes. The Python worker reads
 * `simulation_vars` from participant.attributes, merges it into the
 * template variable map, and renders the prompt/greeting before the LLM
 * session starts.
 */

interface DetectedVar {
  key: string;
  /** Reasonable default when the var name is well-known. */
  suggestion?: string;
}

/** Variables we don't show in the form because the worker fills them in. */
const SYSTEM_VARS = new Set(["current_date", "agent_name"]);

/** Sensible defaults so the tester can hit "Start" without filling 10 fields. */
const SUGGESTIONS: Record<string, string> = {
  firstname: "Sarah",
  lastname: "Johnson",
  patient_firstname: "Sarah",
  patient_lastname: "Johnson",
  display_name: "Sarah Johnson",
  bmi: "42",
  bmi_calculated: "42",
  qualification: "initial",
  patient_stage: "initial",
  note: "Showed interest via web form. Has tried diet + WW with no lasting result.",
  last_call_notes: "Showed interest via web form. Has tried diet + WW with no lasting result.",
  e164: "+447700900000",
  numero_telephone: "+447700900000",
  email: "test@example.com",
};

const LABELS: Record<string, string> = {
  firstname: "Prénom",
  lastname: "Nom",
  patient_firstname: "Prénom du patient",
  patient_lastname: "Nom du patient",
  display_name: "Nom complet",
  bmi: "IMC",
  bmi_calculated: "IMC",
  qualification: "Stage actuel",
  patient_stage: "Stage du patient",
  note: "Notes du dernier appel",
  last_call_notes: "Notes du dernier appel",
  e164: "Téléphone",
  numero_telephone: "Téléphone",
  email: "Email",
};

/** Scan a text blob and return the unique `{{var}}` keys found inside. */
function detectVars(...sources: (string | null | undefined)[]): DetectedVar[] {
  const found = new Map<string, DetectedVar>();
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  for (const src of sources) {
    if (!src) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const key = m[1];
      if (SYSTEM_VARS.has(key)) continue;
      if (!found.has(key)) {
        found.set(key, { key, suggestion: SUGGESTIONS[key] });
      }
    }
  }
  return Array.from(found.values());
}

interface Props {
  systemPrompt: string | null | undefined;
  greeting: string | null | undefined;
  /** Called when the operator hits "Start simulation". Pass the vars dict
   *  on to /api/token via the parent. */
  onStart: (vars: Record<string, string>) => void;
  /** Hide the launcher (parent took control / connection started). */
  disabled?: boolean;
}

export function SimulationLauncher({ systemPrompt, greeting, onStart, disabled }: Props) {
  const detected = useMemo(() => detectVars(systemPrompt, greeting), [systemPrompt, greeting]);
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(detected.map((d) => [d.key, d.suggestion ?? ""])),
  );

  // Re-seed when the prompt changes (e.g. user switches between agents).
  // Detected key set is the source of truth.
  const seeded = detected.map((d) => d.key).join("|");
  useMemo(() => {
    setVals((prev) => {
      const next: Record<string, string> = {};
      for (const d of detected) {
        next[d.key] = prev[d.key] ?? d.suggestion ?? "";
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded]);

  if (detected.length === 0) {
    // Nothing to template — just expose a Start button so the UX stays
    // consistent.
    return (
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Simulation</h3>
        <p style={{ color: "var(--muted)", margin: 0 }}>
          Aucune variable <span className="kbd">{"{{...}}"}</span> détectée dans
          le prompt — la simulation utilisera la configuration brute de l&apos;agent.
        </p>
        <div>
          <button onClick={() => onStart({})} disabled={disabled}>
            ▶ Démarrer la simulation
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div>
        <h3 style={{ margin: 0 }}>Simulation</h3>
        <p style={{ margin: "4px 0 0 0", color: "var(--muted)", fontSize: 13 }}>
          Remplissez les variables que l&apos;agent verra. {detected.length} détectée
          {detected.length > 1 ? "s" : ""} dans le prompt.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {detected.map((d) => (
          <div key={d.key}>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              {LABELS[d.key] ?? d.key}{" "}
              <span className="kbd" style={{ fontSize: 10 }}>{"{{" + d.key + "}}"}</span>
            </label>
            <input
              value={vals[d.key] ?? ""}
              onChange={(e) => setVals((prev) => ({ ...prev, [d.key]: e.target.value }))}
              placeholder={d.suggestion ?? ""}
              style={{ width: "100%" }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => onStart(vals)} disabled={disabled}>
          ▶ Démarrer la simulation
        </button>
        <button
          type="button"
          onClick={() =>
            setVals(Object.fromEntries(detected.map((d) => [d.key, d.suggestion ?? ""])))
          }
          style={{ background: "transparent", border: "1px solid var(--muted)" }}
        >
          Réinitialiser
        </button>
        <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
          Aucun appel réel ne sera passé — simulation navigateur uniquement.
        </span>
      </div>
    </div>
  );
}
