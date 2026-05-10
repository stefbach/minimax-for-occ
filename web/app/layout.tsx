import type { Metadata } from "next";
import "@livekit/components-styles";
import "./globals.css";

export const metadata: Metadata = {
  title: "Axon · Voice Agent Platform",
  description: "Multi-agent voice + chat platform on LiveKit, OpenAI/MiniMax, and n8n.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
