type Datum = { label: string; value: number };

type Props = {
  data: Datum[];
  color?: string;
  height?: number;
  /** When true (the default) every bar's label is rendered along the x-axis.
   *  Set false on dense charts and provide `xTickEvery` instead. */
  showAllLabels?: boolean;
  xTickEvery?: number;
  yFormatter?: (v: number) => string;
  ariaLabel?: string;
};

export function BarChart({
  data,
  color = "var(--accent)",
  height = 200,
  showAllLabels = true,
  xTickEvery = 1,
  yFormatter = (v) => String(v),
  ariaLabel,
}: Props) {
  const width = 720; // virtual viewBox — scales with container
  const padLeft = 36;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 28;

  const max = Math.max(1, ...data.map((d) => d.value));
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const n = Math.max(1, data.length);
  const slot = innerW / n;
  const barW = Math.max(2, slot * 0.7);

  // Y axis ticks (0, 50%, 100%)
  const yTicks = [0, max / 2, max];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label={ariaLabel ?? "Histogramme"}
      style={{ display: "block" }}
    >
      {/* axes */}
      <line
        x1={padLeft}
        y1={padTop}
        x2={padLeft}
        y2={height - padBottom}
        stroke="var(--border-2)"
        strokeWidth={1}
      />
      <line
        x1={padLeft}
        y1={height - padBottom}
        x2={width - padRight}
        y2={height - padBottom}
        stroke="var(--border-2)"
        strokeWidth={1}
      />

      {/* y ticks */}
      {yTicks.map((t, i) => {
        const y = padTop + innerH - (t / max) * innerH;
        return (
          <g key={i}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeDasharray="2 4"
            />
            <text
              x={padLeft - 6}
              y={y + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--muted)"
            >
              {yFormatter(Math.round(t))}
            </text>
          </g>
        );
      })}

      {/* bars */}
      {data.map((d, i) => {
        const h = (d.value / max) * innerH;
        const x = padLeft + i * slot + (slot - barW) / 2;
        const y = padTop + innerH - h;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              fill={color}
              rx={2}
              opacity={d.value === 0 ? 0.25 : 0.9}
            >
              <title>
                {d.label} : {yFormatter(d.value)}
              </title>
            </rect>
          </g>
        );
      })}

      {/* x labels */}
      {data.map((d, i) => {
        if (!showAllLabels && i % xTickEvery !== 0) return null;
        const x = padLeft + i * slot + slot / 2;
        return (
          <text
            key={`l-${i}`}
            x={x}
            y={height - padBottom + 14}
            textAnchor="middle"
            fontSize="10"
            fill="var(--muted)"
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}
