"use client";

/**
 * Sentinel Wave 1 — preflight panel rendered in the campaign wizard step 3,
 * just above the recap section. Receives a pre-computed `PreflightResult`
 * (the wizard builds the input and runs `preflightCampaign` synchronously).
 *
 * UX:
 *  - Title "Vérifications avant lancement".
 *  - Blockers shown first (red), then warnings (orange), then a compact
 *    collapsed "X vérifications OK ▾" disclosing the passed rows.
 *  - When all blockers pass and no warnings remain, shows a green confirmation
 *    "✓ Tout est prêt — tu peux lancer la campagne".
 */

import { useState } from "react";
import type {
  PreflightCheck,
  PreflightResult,
} from "@/lib/sentinel/preflight";

interface Props {
  result: PreflightResult;
}

function ChecksGroup({
  title,
  checks,
  color,
  icon,
}: {
  title: string;
  checks: PreflightCheck[];
  color: string;
  icon: string;
}) {
  if (checks.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color,
          marginBottom: 6,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {title} ({checks.length})
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        {checks.map((c) => (
          <li
            key={c.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${color}`,
              background: `color-mix(in srgb, ${color} 8%, var(--bg-2))`,
            }}
          >
            <span style={{ fontSize: 16, lineHeight: "20px", flexShrink: 0 }}>{icon}</span>
            <div style={{ display: "grid", gap: 2, flex: 1 }}>
              <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{c.label}</div>
              <div className="muted" style={{ fontSize: 12 }}>{c.detail}</div>
              <div style={{ fontSize: 12, color }}>
                <strong>→</strong> {c.remediation}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PreflightPanel({ result }: Props) {
  const [showPassed, setShowPassed] = useState(false);

  const blockers = result.checks.filter((c) => c.severity === "blocker" && !c.passed);
  const warnings = result.checks.filter((c) => c.severity === "warning" && !c.passed);
  const passed = result.checks.filter((c) => c.passed);

  const allClear = blockers.length === 0 && warnings.length === 0;

  return (
    <section
      className="card"
      style={{
        borderColor: blockers.length > 0
          ? "var(--bad)"
          : warnings.length > 0
            ? "var(--warn)"
            : "var(--good)",
      }}
    >
      <h3 style={{ marginBottom: 4 }}>Vérifications avant lancement</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        10 contrôles automatiques sur la configuration. Les blocages doivent être levés
        pour pouvoir créer la campagne.
      </div>

      <ChecksGroup
        title="Blocages — à corriger"
        checks={blockers}
        color="var(--bad)"
        icon="⛔"
      />
      <ChecksGroup
        title="Avertissements — recommandés"
        checks={warnings}
        color="var(--warn)"
        icon="⚠️"
      />

      {allClear && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--good) 12%, var(--bg-2))",
            border: "1px solid var(--good)",
            color: "var(--good)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ✓ Tout est prêt — tu peux lancer la campagne.
        </div>
      )}

      {passed.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="ghost"
            onClick={() => setShowPassed((v) => !v)}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {showPassed ? "▾" : "▸"} {passed.length} vérification{passed.length === 1 ? "" : "s"} OK
          </button>
          {showPassed && (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "8px 0 0",
                display: "grid",
                gap: 4,
              }}
            >
              {passed.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    fontSize: 12,
                    color: "var(--muted)",
                    padding: "2px 4px",
                  }}
                >
                  <span style={{ color: "var(--good)" }}>✓</span>
                  <span>{c.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
