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
      <head>
        {/* Apply the saved theme before first paint so the public homepage
            (and every other page) doesn't flash dark→light on load. Mirrors
            the localStorage contract of ThemeLangSwitcher (axon.theme). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("axon.theme");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark");}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
