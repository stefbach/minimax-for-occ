"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Inline actions on each campaign row: Edit (→ /campaigns/{id}/edit),
// Cancel (PATCH state='cancelled'), Delete (DELETE the row).
//
// Kept here as a tiny client island so the campaigns/page.tsx server
// component stays server-rendered for SEO/SSR — only this trio of buttons
// pays the client-bundle cost.

interface Props {
  id: string;
  name: string;
  state: string;
}

export function CampaignRowActions({ id, name, state }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "cancel" | "delete">(null);
  const isTerminal = state === "cancelled" || state === "completed";
  const isCancelable = !isTerminal;

  async function cancel() {
    if (busy) return;
    if (!confirm(`Annuler la campagne « ${name} » ? Elle ne lancera plus de nouveaux appels.`)) {
      return;
    }
    setBusy("cancel");
    try {
      const r = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "cancelled" }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? `Échec annulation (HTTP ${r.status})`);
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

  const btnStyle: React.CSSProperties = {
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
    gap: 4,
  };

  return (
    <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <Link href={`/campaigns/${id}/edit`} title="Éditer la campagne" style={btnStyle}>
        ✎
      </Link>
      <button
        type="button"
        title={isCancelable ? "Annuler la campagne" : "Déjà terminée / annulée"}
        onClick={cancel}
        disabled={!isCancelable || busy !== null}
        style={{
          ...btnStyle,
          color: isCancelable ? "var(--warn)" : "var(--muted)",
          opacity: isCancelable ? 1 : 0.4,
          cursor: isCancelable && !busy ? "pointer" : "not-allowed",
        }}
      >
        {busy === "cancel" ? "…" : "⏸"}
      </button>
      <button
        type="button"
        title="Supprimer la campagne"
        onClick={remove}
        disabled={busy !== null}
        style={{
          ...btnStyle,
          color: "var(--bad)",
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy === "delete" ? "…" : "🗑"}
      </button>
    </div>
  );
}
