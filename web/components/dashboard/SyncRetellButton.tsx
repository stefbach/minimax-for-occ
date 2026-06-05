"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";

// Manual trigger for the Retell → Axon `calls` ingestion. The hourly Vercel
// cron keeps things current automatically; this button lets an operator pull
// the latest immediately (e.g. to see today's calls right now). Self-contained
// so it doesn't entangle DashboardClient state; reloads on success so every
// KPI reflects the freshly imported calls.
export function SyncRetellButton() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/dashboard/sync-retell?days=2", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        if (j.error === "retell_not_configured") {
          throw new Error(t("Clé Retell non configurée (RETELL_API_KEY)."));
        }
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setMsg(`${j.inserted} ${t("appel(s) importé(s)")}`);
      // Let the operator read the count, then refresh so all KPIs update.
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "error");
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button className="ghost" onClick={run} disabled={busy} title={t("Importer les appels Retell dans le tableau de bord")}>
        {busy ? t("Synchronisation…") : `⟳ ${t("Synchroniser Retell")}`}
      </button>
      {msg && <span className="muted" style={{ fontSize: 11 }}>{msg}</span>}
    </span>
  );
}
