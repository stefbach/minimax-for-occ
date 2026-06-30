"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n";
import { HelpButton } from "@/components/help/HelpButton";

export function SuperviseLivePageHeader() {
  const t = useT();
  const pathname = usePathname();
  const isInbound = pathname?.startsWith("/supervise/live/inbound");

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t("Supervision live")}</h1>
          <div className="subtitle">
            {isInbound
              ? t("Historique et suivi des appels entrants du jour. Mise à jour automatique toutes les 5 secondes.")
              : t("Qui est en ligne, qui parle avec qui, depuis combien de temps. Mise à jour automatique toutes les 5 secondes.")}
          </div>
        </div>
        <HelpButton contextKey="supervise.live" />
      </div>

      {/* Sub-navigation tabs */}
      <div
        style={{
          display: "flex",
          gap: 2,
          borderBottom: "1px solid var(--border)",
          marginBottom: 16,
          paddingTop: 12,
        }}
      >
        <NavTab href="/supervise/live" active={!isInbound}>
          ◉ {t("Agents en ligne")}
        </NavTab>
        <NavTab href="/supervise/live/inbound" active={isInbound}>
          ← {t("Appels entrants")}
        </NavTab>
      </div>
    </div>
  );
}

function NavTab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        padding: "8px 18px",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        color: active ? "var(--accent)" : "var(--muted)",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        textDecoration: "none",
        transition: "color 0.15s",
        marginBottom: -1,
      }}
    >
      {children}
    </Link>
  );
}
