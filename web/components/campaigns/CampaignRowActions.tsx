"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Inline actions on each campaign row.
//
//   ✎  Éditer    → /campaigns/{id}/edit
//   ⏸  Pause     → PATCH state='paused' (reversible; becomes ▶ Resume when paused)
//   🚫  Annuler   → PATCH state='cancelled' (terminal)
//   🗑  Supprimer → DELETE the row
//
// Pause/Resume are non-destructive — a paused campaign keeps its targets
// and can be resumed. Cancel is final: state moves to 'cancelled' and the
// campaign will not dial again, even after a server restart. Delete also
// removes the row entirely (cascading the targets).

interface Props {
  id: string;
  name: string;
  state: string;
}

type Busy = null | "pause" | "resume" | "cancel" | "delete";

export function CampaignRowActions({ id, name, state }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);

  const isRunning = state === "running" || state === "scheduled";
  const isPaused = state === "paused";
  const isTerminal = state === "cancelled" || state === "completed";

  async function patchState(target: "paused" | "running" | "cancelled", verb: Busy, confirmMsg?: string) {
    if (busy) return;
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(verb);
    try {
      const r = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: target }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? `Échec (HTTP ${r.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    if (
      !confirm(
        `SUPPRIMER définitivement « ${name} » ?\n\n` +
          `Cela retire la campagne ET ses cibles. ` +
          `Les appels déjà passés restent dans le journal.`,
      )
    ) {
      return;
    }
    setBusy("delete");
    try {
      const r = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? `Échec suppression (HTTP ${r.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const btn: React.CSSProperties = {
    padding: "3px 8px",
    fontSize: 12,
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 28,
  };
  const disabled = (cond: boolean): React.CSSProperties =>
    cond ? { opacity: 0.35, cursor: "not-allowed" } : {};

  return (
    <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {/* Éditer */}
      <Link
        href={`/campaigns/${id}/edit`}
        title="Éditer la campagne"
        style={btn}
      >
        ✎
      </Link>

      {/* Pause / Resume — same slot, swaps icon based on state */}
      {isPaused ? (
        <button
          type="button"
          title="Reprendre la campagne (resume)"
          onClick={() =>
            patchState("running", "resume", `Reprendre la campagne « ${name} » ?`)
          }
          disabled={busy !== null}
          style={{ ...btn, color: "var(--good)", ...disabled(busy !== null) }}
        >
          {busy === "resume" ? "…" : "▶"}
        </button>
      ) : (
        <button
          type="button"
          title={
            isRunning
              ? "Mettre en pause (réversible — reprise possible)"
              : "Disponible uniquement pour les campagnes running/scheduled"
          }
          onClick={() =>
            patchState(
              "paused",
              "pause",
              `Mettre en pause « ${name} » ? Les appels en cours se terminent, les nouveaux s'arrêtent. Tu pourras reprendre.`,
            )
          }
          disabled={!isRunning || busy !== null}
          style={{ ...btn, color: "var(--warn)", ...disabled(!isRunning || busy !== null) }}
        >
          {busy === "pause" ? "…" : "⏸"}
        </button>
      )}

      {/* Annuler (terminal) */}
      <button
        type="button"
        title={
          isTerminal
            ? "Déjà terminée / annulée"
            : "Annuler définitivement (non réversible)"
        }
        onClick={() =>
          patchState(
            "cancelled",
            "cancel",
            `ANNULER « ${name} » définitivement ? La campagne s'arrête et ne pourra plus être reprise. ` +
              `(Pour stopper temporairement, utilise ⏸ Pause à la place.)`,
          )
        }
        disabled={isTerminal || busy !== null}
        style={{
          ...btn,
          color: "var(--bad)",
          ...disabled(isTerminal || busy !== null),
        }}
      >
        {busy === "cancel" ? "…" : "🚫"}
      </button>

      {/* Supprimer */}
      <button
        type="button"
        title="Supprimer définitivement (cascade les cibles)"
        onClick={remove}
        disabled={busy !== null}
        style={{
          ...btn,
          color: "var(--bad)",
          borderColor: "color-mix(in srgb, var(--bad) 30%, var(--border))",
          ...disabled(busy !== null),
        }}
      >
        {busy === "delete" ? "…" : "🗑"}
      </button>
    </div>
  );
}
