"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

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

type Busy = null | "pause" | "resume" | "cancel" | "delete" | "duplicate";

export function CampaignRowActions({ id, name, state }: Props) {
  const t = useT();
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
        alert((j as { error?: string }).error ?? `Failed (HTTP ${r.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function duplicate() {
    if (busy) return;
    setBusy("duplicate");
    try {
      // Fetch current campaign config.
      const r = await fetch(`/api/campaigns/${id}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? `Failed to fetch campaign (HTTP ${r.status})`);
        return;
      }
      const src = await r.json() as Record<string, unknown>;

      // Create a copy — same config, fresh state, no targets.
      const body: Record<string, unknown> = {
        name: `${src.name as string} (copy)`,
        state: "paused",
      };
      const copy = [
        "agent_handle_id", "agent_team_id", "description", "script_id",
        "phone_number_id", "caller_id_e164", "schedule", "max_concurrency",
        "max_attempts", "retry_delay_min", "amd_enabled", "mission",
        "data_table_id", "contact_list_id",
      ];
      for (const k of copy) {
        if (src[k] !== undefined && src[k] !== null) body[k] = src[k];
      }

      const cr = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!cr.ok) {
        const j = await cr.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? `Failed to duplicate (HTTP ${cr.status})`);
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
        t("Supprimer définitivement") + ` "${name}" ?\n\n` +
          t("Cela supprime la campagne ET toutes ses cibles. Les appels déjà passés restent dans le journal."),
      )
    ) {
      return;
    }
    setBusy("delete");
    try {
      const r = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? `Delete failed (HTTP ${r.status})`);
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
      {/* Duplicate — copies config into a new paused campaign (no targets) */}
      <button
        type="button"
        title={t("Dupliquer cette campagne")}
        onClick={duplicate}
        disabled={busy !== null}
        style={{ ...btn, color: "var(--info)", ...disabled(busy !== null) }}
      >
        {busy === "duplicate" ? "…" : "⧉"}
      </button>

      {/* Edit — links to the campaign detail page */}
      <Link
        href={`/campaigns/${id}`}
        title={t("Voir / modifier la campagne")}
        style={btn}
      >
        ✎
      </Link>

      {/* Pause / Resume — same slot, swaps icon based on state */}
      {isPaused ? (
        <button
          type="button"
          title={t("Reprendre la campagne")}
          onClick={() =>
            patchState("running", "resume", t("Reprendre la campagne") + ` "${name}" ?`)
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
              ? t("Mettre en pause (réversible — peut être reprise)")
              : t("Disponible uniquement pour les campagnes en cours ou planifiées")
          }
          onClick={() =>
            patchState(
              "paused",
              "pause",
              t("Mettre en pause") + ` "${name}" ? ` + t("Les appels en cours se terminent, les nouveaux s'arrêtent. Vous pouvez reprendre à tout moment."),
            )
          }
          disabled={!isRunning || busy !== null}
          style={{ ...btn, color: "var(--warn)", ...disabled(!isRunning || busy !== null) }}
        >
          {busy === "pause" ? "…" : "⏸"}
        </button>
      )}

      {/* Cancel (terminal) */}
      <button
        type="button"
        title={
          isTerminal
            ? t("Déjà terminée / annulée")
            : t("Annuler définitivement (irréversible)")
        }
        onClick={() =>
          patchState(
            "cancelled",
            "cancel",
            t("Annuler définitivement") + ` "${name}" ? ` + t("La campagne s'arrête et ne peut plus être reprise. (Pour stopper temporairement, utilisez ⏸ Pause.)"),
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

      {/* Delete */}
      <button
        type="button"
        title={t("Supprimer définitivement (supprime aussi les cibles)")}
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
