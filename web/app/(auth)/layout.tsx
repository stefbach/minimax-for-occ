import "@livekit/components-styles";
import { Instrument_Serif, JetBrains_Mono, Inter } from "next/font/google";
import "@/components/auth/auth.css";
import { AuthBackLink, AuthFooter } from "@/components/auth/AuthChrome";

// Same editorial faces as the homepage so the auth screens match the brand.
const instrument = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const jetbrains = JetBrains_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
const inter = Inter({ weight: ["300", "400", "500", "600"], subsets: ["latin"], variable: "--font-inter", display: "swap" });

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`ax-auth ${instrument.variable} ${jetbrains.variable} ${inter.variable}`}>
      <div className="ax-auth-inner">
        <AuthBackLink />
        <div className="ax-auth-card">{children}</div>
        <AuthFooter />
      </div>
    </div>
  );
}
