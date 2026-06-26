import type { Metadata, Viewport } from "next";
import "@livekit/components-styles";
import "./globals.css";

export const metadata: Metadata = {
  title: "Axon · Voice Agent Platform",
  description: "Multi-agent voice + chat platform on LiveKit, OpenAI/MiniMax, and n8n.",
};

// Explicit viewport — required for our <980px responsive breakpoints to fire
// correctly on phones. Without `width=device-width` mobile Safari renders the
// page in a fixed 980px viewport then scales down, which defeats the whole
// mobile-friendly pass.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
