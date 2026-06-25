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

type Busy = null | "pause" | "resume" | "cancel" | "delete" | "duplicate";

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
        `Permanently DELETE "${name}"?\n\n` +
          `This removes the campaign AND all its targets. ` +
          `Calls already made remain in the log.`,
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
        title="Duplicate this campaign"
        onClick={duplicate}
        disabled={busy !== null}
        style={{ ...btn, color: "var(--info)", ...disabled(busy !== null) }}
      >
        {busy === "duplicate" ? "…" : "⧉"}
      </button>

      {/* Edit — links to the campaign detail page */}
      <Link
        href={`/campaigns/${id}`}
        title="View / edit campaign"
        style={btn}
      >
        ✎
      </Link>

      {/* Pause / Resume — same slot, swaps icon based on state */}
      {isPaused ? (
        <button
          type="button"
          title="Resume campaign"
          onClick={() =>
            patchState("running", "resume", `Resume campaign "${name}"?`)
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
              ? "Pause (reversible — can be resumed)"
              : "Only available for running/scheduled campaigns"
          }
          onClick={() =>
            patchState(
              "paused",
              "pause",
              `Pause "${name}"? Active calls will finish, new ones stop. You can resume at any time.`,
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
            ? "Already completed / cancelled"
            : "Cancel permanently (irreversible)"
        }
        onClick={() =>
          patchState(
            "cancelled",
            "cancel",
            `Permanently CANCEL "${name}"? The campaign stops and cannot be resumed. ` +
              `(To stop temporarily, use ⏸ Pause instead.)`,
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
        title="Delete permanently (cascades targets)"
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
