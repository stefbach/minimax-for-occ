"use client";

import { useState } from "react";

export type Range = { from: string; to: string };

type Props = {
  value: Range;
  onChange: (next: Range) => void;
};

type Preset = "today" | "7d" | "30d" | "90d" | "custom";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(p: Preset): Range {
  const to = new Date();
  if (p === "today") {
    const from = new Date(to);
    from.setUTCHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const days = p === "7d" ? 7 : p === "30d" ? 30 : 90;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function RangePicker({ value, onChange }: Props) {
  const [preset, setPreset] = useState<Preset>("7d");

  const setPresetAndEmit = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") onChange(presetRange(p));
  };

  const onFrom = (s: string) => {
    const d = new Date(s + "T00:00:00.000Z");
    onChange({ from: d.toISOString(), to: value.to });
  };
  const onTo = (s: string) => {
    const d = new Date(s + "T23:59:59.999Z");
    onChange({ from: value.from, to: d.toISOString() });
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", gap: 4 }}>
        {(["today", "7d", "30d", "90d", "custom"] as Preset[]).map((p) => (
          <button
            key={p}
            type="button"
            className={preset === p ? "subtle" : "ghost"}
            onClick={() => setPresetAndEmit(p)}
            style={{ padding: "6px 10px", fontSize: 13 }}
          >
            {p === "today"
              ? "Aujourd'hui"
              : p === "custom"
                ? "Personnalisé"
                : p}
          </button>
        ))}
      </div>
      {preset === "custom" ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="date"
            value={isoDay(new Date(value.from))}
            onChange={(e) => onFrom(e.target.value)}
            style={{ width: 150 }}
          />
          <span style={{ color: "var(--muted)", fontSize: 13 }}>→</span>
          <input
            type="date"
            value={isoDay(new Date(value.to))}
            onChange={(e) => onTo(e.target.value)}
            style={{ width: 150 }}
          />
        </div>
      ) : null}
    </div>
  );
}
