"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { DeskCampaignCaller } from "./DeskCampaignCaller";

/**
 * "Mes campagnes" — the desk agent's own campaigns, with a start/pause switch.
 *
 * A human-agent (desk) campaign only runs while it's `running`: that's when the
 * dialer sends the pre-call SMS/WhatsApp and dials leads one-by-one into the
 * agent's softphone. This panel lets the agent decide WHEN that starts — they
 * flip it on when they sit down to call, off when they're done.
 *
 * Renders nothing when the agent has no assigned campaigns, so it stays out of
 * the way for agents who only work the rappel queue.
 */
interface DeskCampaign {
  id: string;
  name: string;
  description: string | null;
  state: string;
  mode: string;
  precall: { sms: boolean; whatsapp: boolean } | null;
  target_total: number;
  target_done: number;
  target_pending: number;
}

export function DeskCampaigns() {
  const t = useT();
  const [campaigns, setCampaigns] = useState<DeskCampaign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The campaign whose manual caller is open (one at a time).
  const [caller, setCaller] = useState<{ id: string; name: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/desk/campaigns", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { campaigns?: DeskCampaign[] };
      setCampaigns(j.campaigns ?? []);
    } catch {
      /* best-effort */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const i = setInterval(refresh, 15_000);
    return () => clearInterval(i);
  }, [refresh]);

  async function toggle(c: DeskCampaign) {
    const activate = c.state !== "running";
    setBusy(c.id);
    setErr(null);
    // Optimistic flip so the switch feels instant.
    setCampaigns((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, state: activate ? "running" : "paused" } : x)),
    );
    try {
      const r = await fetch(`/api/desk/campaigns/${c.id}/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activate }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      await refresh(); // roll back to server truth
    } finally {
      setBusy(null);
    }
  }

  // Hide entirely until we know there's something to show.
  if (!loaded || campaigns.length === 0) return null;

  return (
    <section className="card" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ margin: 0 }}>{t("Mes campagnes")}</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {t("Active une campagne pour lancer l'envoi des messages et les appels.")}
        </span>
      </div>

      {err && <div style={{ color: "var(--bad)", fontSize: 12 }}>{err}</div>}

      <div style={{ display: "grid", gap: 8 }}>
        {campaigns.map((c) => {
          const running = c.state === "running";
          return (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                border: `1px solid ${running ? "var(--accent)" : "var(--border)"}`,
                background: running ? "var(--accent-soft, var(--bg-2))" : "var(--bg-2)",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 14 }}>{c.name}</strong>
                  <span
                    className="tag"
                    style={{
                      fontSize: 10,
                      color: running ? "var(--good, #2f855a)" : "var(--muted)",
                      borderColor: running ? "var(--good, #2f855a)" : "var(--border)",
                    }}
                  >
                    {running ? `● ${t("En cours")}` : t("En pause")}
                  </span>
                  {c.precall?.sms && <span className="tag" style={{ fontSize: 10 }}>💬 SMS</span>}
                  {c.precall?.whatsapp && <span className="tag" style={{ fontSize: 10 }}>🟢 WhatsApp</span>}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                  {c.target_pending} {t("à appeler")} · {c.target_done} {t("faits")}
                  {c.target_total > 0 ? ` · ${c.target_total} ${t("total")}` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {running && (
                  <button
                    onClick={() => setCaller(caller?.id === c.id ? null : { id: c.id, name: c.name })}
                    style={{ padding: "8px 14px", fontWeight: 600, whiteSpace: "nowrap" }}
                  >
                    📞 {caller?.id === c.id ? t("Masquer") : t("Appeler les leads")}
                  </button>
                )}
                <button
                  onClick={() => toggle(c)}
                  disabled={busy === c.id}
                  className="ghost"
                  style={{ padding: "8px 14px", fontWeight: 600, whiteSpace: "nowrap", borderColor: "var(--border)" }}
                >
                  {busy === c.id
                    ? "…"
                    : running
                      ? `⏸ ${t("Désactiver")}`
                      : `▶ ${t("Activer")}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Manual caller for the campaign the agent opened. */}
      {caller && (
        <DeskCampaignCaller campaign={caller} onClose={() => setCaller(null)} />
      )}
    </section>
  );
}
