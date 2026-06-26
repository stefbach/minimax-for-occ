/**
 * Procedural neural-network "brain". Pure SVG + CSS animations, no JS deps.
 * Two halves of evenly-distributed neurons connected by axons; the central
 * core pulses; a gradient ring frames the whole thing.
 */
export function BrainHero() {
  // Polar layout with two lobes (left/right brain) spiralling outward.
  const N = 28;
  const neurons = Array.from({ length: N }, (_, i) => {
    const lobe = i % 2 === 0 ? -1 : 1; // left or right
    const t = i / N;
    const angle = lobe * (0.4 + t * 1.7) * Math.PI;
    const r = 70 + (i % 6) * 14;
    return {
      cx: 200 + Math.cos(angle) * r * 0.95 + lobe * 12,
      cy: 200 + Math.sin(angle) * r * 0.6,
      rad: 3 + ((i * 7) % 4),
    };
  });

  // Connect each neuron to the 2 nearest others to form a sparse graph.
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < neurons.length; i++) {
    const others = neurons
      .map((n, j) => ({
        j,
        d: Math.hypot(n.cx - neurons[i].cx, n.cy - neurons[i].cy),
      }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const o of others) {
      if (o.j > i) {
        lines.push({
          x1: neurons[i].cx,
          y1: neurons[i].cy,
          x2: neurons[o.j].cx,
          y2: neurons[o.j].cy,
        });
      }
    }
  }

  return (
    <div className="brain-wrap" aria-hidden="true">
      <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="core-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff6b35" stopOpacity="0.95" />
            <stop offset="60%" stopColor="#ff6b35" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ff6b35" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ff6b35" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* outer ring */}
        <circle
          cx="200"
          cy="200"
          r="180"
          fill="none"
          stroke="url(#ring-grad)"
          strokeOpacity="0.18"
          strokeWidth="1"
        />
        <circle
          cx="200"
          cy="200"
          r="140"
          fill="none"
          stroke="url(#ring-grad)"
          strokeOpacity="0.10"
          strokeWidth="1"
          strokeDasharray="2 4"
        />

        {/* central core */}
        <circle className="core" cx="200" cy="200" r="36" fill="url(#core-grad)" />
        <circle className="core" cx="200" cy="200" r="14" fill="#ff6b35" filter="url(#glow)" opacity="0.9" />

        {/* axons (lines between neurons) */}
        {lines.map((l, i) => (
          <line
            key={`a${i}`}
            className="axon"
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="#60a5fa"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        ))}

        {/* neurons */}
        {neurons.map((n, i) => (
          <circle
            key={`n${i}`}
            className="neuron"
            cx={n.cx}
            cy={n.cy}
            r={n.rad}
            fill={i % 3 === 0 ? "#ff6b35" : "#e7ecf3"}
            filter="url(#glow)"
            opacity={0.85}
          />
        ))}
      </svg>
    </div>
  );
}
