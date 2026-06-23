/**
 * Hand-drawn line icon set for the public homepage (and its 3D scene).
 * Replaces emojis with consistent 24×24 stroke icons that inherit
 * currentColor, so they follow the violet palette and day/night theme.
 */

type IconProps = { size?: number; strokeWidth?: number };

function Svg({
  size = 24,
  strokeWidth = 1.8,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/* Santé & cliniques — heart with pulse line */
export function IconSante(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19.5 13.2c1.2-1.4 2-3 2-4.6A4.6 4.6 0 0 0 12 6.2 4.6 4.6 0 0 0 2.5 8.6c0 4.8 6.5 9.6 9.5 11.4 1-.6 2.4-1.6 3.8-2.8" />
      <path d="M5 12.5h3.5l1.5-3 3 6 1.5-3H19" />
    </Svg>
  );
}

/* Immobilier — house */
export function IconImmobilier(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 10.8 12 3l9 7.8" />
      <path d="M5.5 9.5V21h13V9.5" />
      <path d="M10 21v-6.5h4V21" />
    </Svg>
  );
}

/* Hôtellerie & restauration — concierge bell */
export function IconHotellerie(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 17a7.5 7.5 0 0 1 15 0" />
      <path d="M12 9.5V7" />
      <path d="M10 7h4" />
      <path d="M2.5 20h19" />
      <path d="M2.5 17h19" />
    </Svg>
  );
}

/* E-commerce & retail — shopping bag */
export function IconEcommerce(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6.5 2.5 4 6.5V20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6.5l-2.5-4z" />
      <path d="M4 6.5h16" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </Svg>
  );
}

/* Assurance & finance — shield with check */
export function IconAssurance(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10z" />
      <path d="m9 11.5 2.2 2.2L15.5 9" />
    </Svg>
  );
}

/* Support & service client — headset */
export function IconSupport(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 13.5v-2a9 9 0 0 1 18 0v2" />
      <path d="M3 13.5h3a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 6 19.5H4.5A1.5 1.5 0 0 1 3 18v-4.5z" />
      <path d="M21 13.5h-3a1.5 1.5 0 0 0-1.5 1.5v3a1.5 1.5 0 0 0 1.5 1.5H19a2 2 0 0 0 2-2v-4z" />
      <path d="M21 17v1.5a3 3 0 0 1-3 3h-4" />
    </Svg>
  );
}

/* Voix — studio microphone */
export function IconMic(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5" />
      <path d="M8.5 21.5h7" />
    </Svg>
  );
}

/* Cerveau LLM — processor chip */
export function IconBrain(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </Svg>
  );
}

/* Appel entrant — phone with inbound arrow */
export function IconPhoneIn(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 16.9v2.6a1.8 1.8 0 0 1-2 1.8 17.9 17.9 0 0 1-7.8-2.8 17.6 17.6 0 0 1-5.4-5.4A17.9 17.9 0 0 1 3 5.2a1.8 1.8 0 0 1 1.8-2h2.6a1.8 1.8 0 0 1 1.8 1.6c.1.9.4 1.8.7 2.6a1.8 1.8 0 0 1-.4 1.9L8.3 10.5a14.4 14.4 0 0 0 5.2 5.2l1.2-1.2a1.8 1.8 0 0 1 1.9-.4c.8.3 1.7.6 2.6.7a1.8 1.8 0 0 1 1.8 1.9z" />
      <path d="M15.5 8.5 21 3" />
      <path d="M15.5 4.5v4h4" />
    </Svg>
  );
}

/* Appel sortant — phone with outbound arrow */
export function IconPhoneOut(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 16.9v2.6a1.8 1.8 0 0 1-2 1.8 17.9 17.9 0 0 1-7.8-2.8 17.6 17.6 0 0 1-5.4-5.4A17.9 17.9 0 0 1 3 5.2a1.8 1.8 0 0 1 1.8-2h2.6a1.8 1.8 0 0 1 1.8 1.6c.1.9.4 1.8.7 2.6a1.8 1.8 0 0 1-.4 1.9L8.3 10.5a14.4 14.4 0 0 0 5.2 5.2l1.2-1.2a1.8 1.8 0 0 1 1.9-.4c.8.3 1.7.6 2.6.7a1.8 1.8 0 0 1 1.8 1.9z" />
      <path d="M15.5 8.5 21 3" />
      <path d="M17 3h4v4" />
    </Svg>
  );
}

/* 24h/24 — clock */
export function IconClock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  );
}

/* Multilingue — globe */
export function IconGlobe(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14.2 14.2 0 0 1 0 18 14.2 14.2 0 0 1 0-18z" />
    </Svg>
  );
}

/* Supervision — eye */
export function IconEye(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}
