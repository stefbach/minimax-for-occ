export function Brand({ size = 16 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: size }}>
      <span className="dot" />
      <span>
        Axon<span style={{ color: "var(--accent)" }}>.</span>
      </span>
    </span>
  );
}
