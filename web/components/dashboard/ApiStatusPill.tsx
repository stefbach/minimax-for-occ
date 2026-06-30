"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type HealthChecks = Record<string, "ok" | "fail" | "skipped">;

const SERVICE_LABELS: Record<string, string> = {
  supabase: "Supabase",
  deepseek: "DeepSeek AI",
  twilio: "Twilio",
  livekit: "LiveKit",
  n8n: "N8N",
};

export function ApiStatusPill() {
  const t = useT();
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
  const [checks, setChecks] = useState<HealthChecks>({});
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const j = (await r.json()) as { ok?: boolean; checks?: HealthChecks };
        if (!alive) return;
        setChecks(j.checks ?? {});
        setState(j.ok ? "ok" : "fail");
      } catch {
        if (!alive) return;
        setChecks({});
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

  const checkEntries = Object.entries(checks);

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          padding: "6px 12px", fontSize: 13, borderRadius: 999, whiteSpace: "nowrap",
          border: "1px solid var(--border)",
          background: `color-mix(in srgb, ${color} 10%, transparent)`,
          cursor: "default",
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

      {hovered && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          zIndex: 300,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
          padding: "10px 14px",
          minWidth: 200,
          fontSize: 13,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>
            {t("État des services")}
          </div>
          {checkEntries.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>{t("Vérification en cours…")}</div>
          ) : (
            checkEntries.map(([key, val]) => {
              const dot = val === "ok" ? "var(--good)" : val === "fail" ? "var(--bad)" : "var(--muted)";
              const status = val === "ok" ? t("OK") : val === "fail" ? t("Incident") : t("Non configuré");
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: dot, flexShrink: 0 }} />
                  <span style={{ flex: 1, color: "var(--text)" }}>{SERVICE_LABELS[key] ?? key}</span>
                  <span style={{ color: dot, fontWeight: 500 }}>{status}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </span>
  );
}
