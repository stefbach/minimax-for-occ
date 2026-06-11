"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

// Live service-health pill — legacy-dashboard parity with "Retell API
// operational". Polls /api/health every 60s; green when every configured
// dependency answers, red otherwise, with the failing services in the
// tooltip. /api/health returns 503 on failure so we read the JSON either way.

type HealthChecks = Record<string, "ok" | "fail" | "skipped">;

export function ApiStatusPill() {
  const t = useT();
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
  const [failing, setFailing] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const j = (await r.json()) as { ok?: boolean; checks?: HealthChecks };
        if (!alive) return;
        const bad = Object.entries(j.checks ?? {})
          .filter(([, v]) => v === "fail")
          .map(([k]) => k);
        setFailing(bad);
        setState(j.ok ? "ok" : "fail");
      } catch {
        if (!alive) return;
        setFailing([]);
        setState("fail");
      }
    };
    ping();
    const id = setInterval(ping, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const color = state === "ok" ? "var(--good)" : state === "fail" ? "var(--bad)" : "var(--muted)";
  const label =
    state === "ok" ? t("API opérationnelle")
    : state === "fail" ? t("API : incident")
    : t("API…");
  const title = state === "fail" && failing.length > 0
    ? `${t("Services en échec")} : ${failing.join(", ")}`
    : t("État des services (Supabase, Twilio, LiveKit…)");

  return (
    <span
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        padding: "6px 12px", fontSize: 13, borderRadius: 999, whiteSpace: "nowrap",
        border: "1px solid var(--border)",
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8, height: 8, borderRadius: 99, background: color,
          boxShadow: state === "ok" ? `0 0 6px ${color}` : undefined,
        }}
      />
      {label}
    </span>
  );
}
