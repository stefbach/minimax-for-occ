import "@livekit/components-styles";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>{children}</div>
    </div>
  );
}
