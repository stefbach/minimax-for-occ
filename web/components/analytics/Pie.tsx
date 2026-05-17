type Segment = { label: string; value: number; color: string };

type Props = {
  segments: Segment[];
  size?: number;
  /** Inner radius ratio — 0 = full pie, 0.55 = donut. */
  donut?: number;
  ariaLabel?: string;
};

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

export function Pie({ segments, size = 220, donut = 0.55, ariaLabel }: Props) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  const ir = r * donut;

  if (total === 0) {
    return (
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="var(--panel-2)" />
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fontSize="12"
          fill="var(--muted)"
        >
          aucune donnée
        </text>
      </svg>
    );
  }

  let start = -Math.PI / 2; // start at 12 o'clock

  const paths = segments.map((s, i) => {
    const angle = (s.value / total) * Math.PI * 2;
    const end = start + angle;
    const large = angle > Math.PI ? 1 : 0;
    const [x1, y1] = polar(cx, cy, r, start);
    const [x2, y2] = polar(cx, cy, r, end);
    const [xi2, yi2] = polar(cx, cy, ir, end);
    const [xi1, yi1] = polar(cx, cy, ir, start);

    // Avoid degenerate paths when a segment is the full circle.
    const full = segments.length === 1;
    const d = full
      ? `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} Z`
      : `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ir} ${ir} 0 ${large} 0 ${xi1} ${yi1} Z`;

    start = end;
    return (
      <path key={i} d={d} fill={s.color} stroke="var(--panel)" strokeWidth={1}>
        <title>
          {s.label} — {s.value} ({((s.value / total) * 100).toFixed(1)}%)
        </title>
      </path>
    );
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel ?? "Camembert"}
    >
      {paths}
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize="12"
        fill="var(--muted)"
      >
        Total
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        fontSize="18"
        fontWeight={700}
        fill="var(--text)"
      >
        {total}
      </text>
    </svg>
  );
}
