type Props = {
  label: string;
  value: string;
  hint?: string;
  accent?: "default" | "good" | "warn" | "bad" | "info";
};

const COLOR: Record<NonNullable<Props["accent"]>, string> = {
  default: "var(--accent-2)",
  good: "var(--good)",
  warn: "var(--warn)",
  bad: "var(--bad)",
  info: "var(--info)",
};

export function KpiTile({ label, value, hint, accent = "default" }: Props) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ color: "var(--muted)", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: COLOR[accent], lineHeight: 1.1 }}>
        {value}
      </div>
      {hint ? (
        <div style={{ color: "var(--muted)", fontSize: 12 }}>{hint}</div>
      ) : null}
    </div>
  );
}
