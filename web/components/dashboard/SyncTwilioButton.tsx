"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";

// Manual trigger for the Twilio → Axon `calls` reconciliation. The webhook
// captures Twilio calls in real time; this button (and the hourly cron) is a
// safety net that pulls Twilio's call history to catch anything a webhook
// dropped, and to fix calls left stuck in an active state.
export function SyncTwilioButton() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/dashboard/sync-twilio?days=2", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        if (j.error === "twilio_not_configured") {
          throw new Error(t("Identifiants Twilio non configurés sur ce déploiement."));
        }
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const inserted = Number(j.inserted ?? 0);
      const reconciled = Number(j.reconciled ?? 0);
      setMsg(
        `${inserted} ${t("importé(s)")} · ${reconciled} ${t("réconcilié(s)")} · ${j.fetched ?? 0} ${t("vus")}`,
      );
      if (inserted > 0 || reconciled > 0) setTimeout(() => window.location.reload(), 1500);
      else setBusy(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button className="ghost" onClick={run} disabled={busy} title={t("Réconcilier l'historique des appels Twilio")}>
        {busy ? t("Synchronisation…") : `⟳ ${t("Synchroniser Twilio")}`}
      </button>
      {msg && <span className="muted" style={{ fontSize: 11 }}>{msg}</span>}
    </span>
  );
}
