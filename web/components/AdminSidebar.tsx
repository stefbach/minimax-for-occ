"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./brand/Brand";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: string;
}

const NAV: NavItem[] = [
  // ── Platform ──
  { href: "/admin",          label: "Overview",             icon: "▣", group: "Platform" },
  { href: "/admin/orgs",     label: "Clients",              icon: "◯", group: "Platform" },
  { href: "/admin/copilot",  label: "Super Admin Copilot",  icon: "✦", group: "Platform" },

  // ── Platform Ops ──
  { href: "/admin/inbound",    label: "Inbound connectors", icon: "⇩", group: "Platform Ops" },
  { href: "/admin/compliance", label: "Compliance (DNC)",   icon: "⊘", group: "Platform Ops" },
  { href: "/admin/gdpr",       label: "GDPR",               icon: "⚖", group: "Platform Ops" },

  // ── Axon Billing ──
  { href: "/admin/billing",  label: "Billing",              icon: "€", group: "Axon Billing" },
];

export function AdminSidebar() {
  const pathname = usePathname() ?? "/";

  const groups: Record<string, NavItem[]> = {};
  for (const item of NAV) {
    (groups[item.group] ??= []).push(item);
  }

  return (
    <nav className="sidebar">
      <Link href="/admin" className="brand">
        <Brand size={18} />
      </Link>

      {Object.entries(groups).map(([group, items]) => (
        <div key={group} style={{ marginTop: 6 }}>
          <div
            style={{
              fontSize: 10,
              color: "var(--muted-2)",
              textTransform: "uppercase",
              letterSpacing: 1,
              padding: "10px 12px 4px",
            }}
          >
            {group}
          </div>
          {items.map((n) => {
            const active =
              n.href === "/admin"
                ? pathname === "/admin"
                : pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`nav-link ${active ? "active" : ""}`}
                aria-label={n.label}
                aria-current={active ? "page" : undefined}
              >
                <span aria-hidden="true" style={{ width: 16, opacity: 0.7 }}>{n.icon}</span>
                <span>{n.label}</span>
              </Link>
            );
          })}
        </div>
      ))}

      <div style={{ marginTop: "auto" }}>
        <Link
          href="/"
          className="nav-link"
          style={{ fontSize: 12, color: "var(--muted-2)" }}
          aria-label="Exit admin mode"
        >
          <span aria-hidden="true" style={{ width: 16, opacity: 0.7 }}>←</span>
          <span>Exit admin mode</span>
        </Link>
        <div style={{ padding: "10px 12px", color: "var(--muted-2)", fontSize: 11 }}>
          Axon Admin · v2
        </div>
      </div>
    </nav>
  );
}
