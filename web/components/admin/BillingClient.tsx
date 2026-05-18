"use client";

import { useEffect, useState } from "react";

interface Plan {
  slug: string;
  name: string;
  monthly_price_cents: number;
  included_minutes: number;
  included_llm_tokens: number;
  included_tts_chars: number;
  included_stt_minutes: number;
}

interface UsageBucket {
  quantity: number;
  cost_cents: number;
  limit: number;
}

interface UsageResponse {
  org_id: string;
  month: string;
  plan: Plan;
  usage: {
    call_minutes: UsageBucket;
    llm_tokens: UsageBucket;
    tts_chars: UsageBucket;
    stt_minutes: UsageBucket;
  };
}

const COUNTERS: Array<{
  key: keyof UsageResponse["usage"];
  label: string;
  unit: string;
  fmt: (n: number) => string;
}> = [
  { key: "call_minutes", label: "Minutes d'appel (Twilio)", unit: "min",   fmt: (n) => n.toLocaleString("fr-FR") },
  { key: "llm_tokens",   label: "Tokens LLM (OpenAI)",       unit: "tok",   fmt: (n) => n.toLocaleString("fr-FR") },
  { key: "tts_chars",    label: "Caractères TTS (MiniMax)",  unit: "chars", fmt: (n) => n.toLocaleString("fr-FR") },
  { key: "stt_minutes",  label: "Minutes STT (Deepgram)",    unit: "min",   fmt: (n) => n.toLocaleString("fr-FR") },
];

function formatPrice(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

function percent(used: number, limit: number): number {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function BillingClient() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upgradeBusy, setUpgradeBusy] = useState<string | null>(null);
  const [upgradeMsg, setUpgradeMsg] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [uRes, pRes] = await Promise.all([
        fetch("/api/billing/usage", { cache: "no-store" }),
        fetch("/api/billing/plans", { cache: "no-store" }),
      ]);
      if (!uRes.ok) throw new Error(`usage: ${uRes.status}`);
      if (!pRes.ok) throw new Error(`plans: ${pRes.status}`);
      const u = (await uRes.json()) as UsageResponse;
      const p = (await pRes.json()) as Plan[];
      setUsage(u);
      setPlans(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function upgrade(slug: string) {
    setUpgradeBusy(slug);
    setUpgradeMsg(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan_slug: slug }),
      });
      const j = (await res.json()) as { url?: string; mock?: boolean; warning?: string; error?: string };
      if (!res.ok) {
        setUpgradeMsg(j.error ?? `Erreur ${res.status}`);
        return;
      }
      if (j.mock) {
        setUpgradeMsg(j.warning ?? "Mode démo — plan mis à jour localement, aucun paiement effectué.");
        await refresh();
      } else if (j.url) {
        window.location.href = j.url;
      }
    } catch (e) {
      setUpgradeMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUpgradeBusy(null);
    }
  }

  if (loading) {
    return <div className="card" style={{ color: "var(--muted)" }}>Chargement…</div>;
  }
  if (error) {
    return <div className="card" style={{ color: "var(--bad)" }}>{error}</div>;
  }
  if (!usage) {
    return <div className="card" style={{ color: "var(--muted)" }}>Aucune donnée.</div>;
  }

  const currentPlan = usage.plan;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Plan actuel ──────────────────────────────────────────────── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: 1 }}>
              Plan actuel · {usage.month}
            </div>
            <h2 style={{ margin: "6px 0 0" }}>{currentPlan.name}</h2>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              {formatPrice(currentPlan.monthly_price_cents)} / mois
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted-2)" }}>
            Org : <span className="kbd" style={{ fontSize: 11 }}>{usage.org_id.slice(0, 8)}…</span>
          </div>
        </div>
      </div>

      {/* ── Compteurs du mois ────────────────────────────────────────── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Consommation du mois</h3>
        <div style={{ display: "grid", gap: 12 }}>
          {COUNTERS.map((c) => {
            const bucket = usage.usage[c.key];
            const pct = percent(bucket.quantity, bucket.limit);
            const over = bucket.limit > 0 && bucket.quantity > bucket.limit;
            return (
              <div key={c.key} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 13 }}>
                  <strong>{c.label}</strong>
                  <span style={{ color: over ? "var(--bad)" : "var(--muted)" }}>
                    {c.fmt(bucket.quantity)} {c.unit}
                    {bucket.limit > 0 && ` / ${c.fmt(bucket.limit)} ${c.unit}`}
                    {bucket.cost_cents > 0 && ` · ${formatPrice(bucket.cost_cents)}`}
                  </span>
                </div>
                <div
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: "var(--bg-2, #1a1a1a)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: over ? "var(--bad)" : pct > 80 ? "var(--warn, #d97706)" : "var(--accent, #4ade80)",
                      transition: "width .3s ease",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Plans disponibles + upgrade ───────────────────────────────── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Plans disponibles</h3>
        {upgradeMsg && (
          <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(74, 222, 128, 0.08)", border: "1px solid rgba(74, 222, 128, 0.3)", marginBottom: 12, fontSize: 13 }}>
            {upgradeMsg}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {plans.map((p) => {
            const isCurrent = p.slug === currentPlan.slug;
            return (
              <div
                key={p.slug}
                style={{
                  padding: 14,
                  border: isCurrent ? "1px solid var(--accent, #4ade80)" : "1px solid var(--border, #2a2a2a)",
                  borderRadius: 8,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{p.name}</strong>
                  {isCurrent && (
                    <span className="kbd" style={{ fontSize: 10 }}>actuel</span>
                  )}
                </div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{formatPrice(p.monthly_price_cents)}<span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400 }}> /mois</span></div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
                  <li>{p.included_minutes.toLocaleString("fr-FR")} min d&apos;appel</li>
                  <li>{p.included_llm_tokens.toLocaleString("fr-FR")} tokens LLM</li>
                  <li>{p.included_tts_chars.toLocaleString("fr-FR")} caractères TTS</li>
                  <li>{p.included_stt_minutes.toLocaleString("fr-FR")} min STT</li>
                </ul>
                <button
                  onClick={() => upgrade(p.slug)}
                  disabled={isCurrent || upgradeBusy === p.slug}
                  style={{ marginTop: 4 }}
                >
                  {upgradeBusy === p.slug
                    ? "…"
                    : isCurrent
                    ? "Plan actif"
                    : "Choisir ce plan"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Historique factures (placeholder) ─────────────────────────── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Historique des factures</h3>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>
          L&apos;historique des factures Stripe sera affiché ici une fois
          l&apos;intégration complète activée. Pour le moment vous pouvez
          retrouver vos reçus directement dans le portail Stripe.
        </div>
      </div>
    </div>
  );
}
