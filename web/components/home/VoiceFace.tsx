import {
  IconAssurance,
  IconEcommerce,
  IconHotellerie,
  IconImmobilier,
  IconSante,
  IconSupport,
} from "./icons";

const BRANCHES: { d: string; y: number; label: string; Icon: typeof IconSante }[] = [
  { d: "M352 218 C 500 198, 600 108, 772 80", y: 80, label: "Santé", Icon: IconSante },
  { d: "M352 221 C 510 210, 615 160, 772 152", y: 152, label: "Immobilier", Icon: IconImmobilier },
  { d: "M354 224 C 520 220, 625 222, 772 224", y: 224, label: "Hôtellerie", Icon: IconHotellerie },
  { d: "M354 227 C 520 238, 625 282, 772 296", y: 296, label: "E-commerce", Icon: IconEcommerce },
  { d: "M352 230 C 510 250, 615 326, 772 368", y: 368, label: "Assurance", Icon: IconAssurance },
  { d: "M352 233 C 500 260, 600 390, 772 440", y: 440, label: "Support", Icon: IconSupport },
];

const WAVES = [
  "M348 210 a18 18 0 0 1 0 31",
  "M360 200 a31 31 0 0 1 0 51",
  "M372 190 a44 44 0 0 1 0 71",
];

const HAIR = [
  "M242 58 C 175 62, 132 98, 124 152 C 116 212, 142 260, 122 322 C 112 354, 94 376, 74 388",
  "M248 60 C 192 74, 162 110, 158 162 C 154 216, 172 266, 152 330 C 144 356, 130 374, 114 386",
  "M256 68 C 212 88, 192 122, 190 168 C 188 214, 200 254, 186 306",
  "M258 78 C 228 102, 218 134, 220 176 C 222 214, 230 248, 224 292 C 226 324, 228 348, 226 368",
  "M242 58 C 270 56, 298 68, 312 88",
];

export function VoiceFace() {
  return (
    <div className="mk-face-wrap">
      <svg
        viewBox="0 0 980 540"
        fill="none"
        role="img"
        aria-label="Une voix de femme qui se transforme en six agents vocaux métiers"
        className="mk-face"
      >
        <defs>
          <filter id="mkf-blur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="42" />
          </filter>
        </defs>

        <circle cx="235" cy="205" r="140" fill="var(--accent-soft)" filter="url(#mkf-blur)" />

        {HAIR.map((d) => (
          <path key={d} d={d} className="mk-face-hair" />
        ))}

        <path
          className="mk-face-contour"
          d="M242 58
             C 290 66, 316 104, 318 142
             C 318 152, 316 158, 318 163
             C 330 178, 338 190, 341 199
             C 342 205, 334 208, 327 209
             C 329 216, 333 219, 331 224
             C 336 227, 335 231, 330 233
             C 333 239, 332 245, 326 250
             C 318 259, 308 263, 300 264
             C 295 270, 292 280, 291 292
             C 288 318, 286 344, 286 368"
        />
        <path className="mk-face-contour mk-face-fine" d="M300 264 C 281 268, 263 265, 252 255" />
        <path className="mk-face-contour mk-face-fine" d="M296 166 C 303 171, 311 171, 317 167" />
        <circle cx="254" cy="270" r="3" fill="var(--accent)" />

        {WAVES.map((d, i) => (
          <path key={d} d={d} className="mk-face-wave" style={{ animationDelay: `${i * 0.45}s` }} />
        ))}

        {BRANCHES.map((b, i) => (
          <path
            key={b.label}
            d={b.d}
            className="mk-face-flow"
            style={{ animationDelay: `${i * 0.5}s` }}
          />
        ))}

        {BRANCHES.map(({ y, label, Icon }) => (
          <g key={label}>
            <circle cx="802" cy={y} r="27" className="mk-face-node" />
            <g transform={`translate(790, ${y - 12})`} className="mk-face-node-icon">
              <Icon size={24} strokeWidth={1.7} />
            </g>
            <text x="844" y={y + 5} className="mk-face-node-label">
              {label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
