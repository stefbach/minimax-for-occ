"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./brand/Brand";

const NAV = [
  { href: "/", label: "Accueil", icon: "◎" },
  { href: "/agents", label: "Agents", icon: "◇" },
  { href: "/workflows", label: "Workflows n8n", icon: "⇄" },
  { href: "/documents", label: "Documents (RAG)", icon: "≡" },
  { href: "/settings", label: "Paramètres", icon: "⚙" },
];

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="sidebar">
      <Link href="/" className="brand">
        <Brand size={18} />
      </Link>
      {NAV.map((n) => {
        const active =
          n.href === "/"
            ? pathname === "/"
            : pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`nav-link ${active ? "active" : ""}`}
          >
            <span aria-hidden="true" style={{ width: 16, opacity: 0.7 }}>{n.icon}</span>
            <span>{n.label}</span>
          </Link>
        );
      })}
      <div style={{ marginTop: "auto", padding: "12px 10px", color: "var(--muted-2)", fontSize: 11 }}>
        Axon Voice Platform · v0.1
      </div>
    </nav>
  );
}
