/** AXON node-mark — same glyph as the homepage nav logo, for the auth screens. */
export function AuthMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden>
      <circle cx="13" cy="13" r="12.5" stroke="#F5EFE3" strokeWidth=".8" />
      <circle cx="13" cy="13" r="3" fill="#D66B3C" />
      <circle cx="13" cy="4.5" r="1.6" fill="#F5EFE3" />
      <circle cx="21" cy="17" r="1.6" fill="#F5EFE3" />
      <circle cx="5" cy="17" r="1.6" fill="#F5EFE3" />
      <line x1="13" y1="13" x2="13" y2="4.5" stroke="#F5EFE3" strokeWidth=".6" strokeOpacity=".5" />
      <line x1="13" y1="13" x2="21" y2="17" stroke="#F5EFE3" strokeWidth=".6" strokeOpacity=".5" />
      <line x1="13" y1="13" x2="5" y2="17" stroke="#F5EFE3" strokeWidth=".6" strokeOpacity=".5" />
    </svg>
  );
}
