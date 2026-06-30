// @deprecated use AdminSidebar or ClientSidebar
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "./brand/Brand";
import { OrgSwitcher } from "./OrgSwitcher";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Role = "super_admin" | "admin" | "manager" | "supervisor" | "agent";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: string;
  /** Which roles can see this entry. Empty/omitted = everyone. */
  roles?: Role[];
}

const NAV: NavItem[] = [
  // ── Overview ──
  { href: "/dashboard", label: "Dashboard",         icon: "▣", group: "Overview", roles: ["super_admin","admin","manager","supervisor"] },
  { href: "/analytics", label: "Analytics",         icon: "▤", group: "Overview", roles: ["super_admin","admin","manager","supervisor"] },
  { href: "/desk",      label: "My desk",           icon: "⌂", group: "Overview" },

  // ── Operations ──
  { href: "/calls",     label: "Calls (live)",      icon: "☎", group: "Operations", roles: ["super_admin","admin","manager","supervisor"] },
  { href: "/queues",    label: "Queues",            icon: "≡", group: "Operations", roles: ["super_admin","admin","manager","supervisor"] },
  { href: "/campaigns", label: "Campaigns",         icon: "⇈", group: "Operations", roles: ["super_admin","admin","manager"] },
  { href: "/alerts",    label: "Alerts",            icon: "!", group: "Operations", roles: ["super_admin","admin","manager","supervisor"] },

  // ── Builder ──
  { href: "/agents",    label: "AI Agents",         icon: "◇", group: "Builder", roles: ["super_admin","admin","manager"] },
  { href: "/agents/library", label: "Persona library",    icon: "⊕", group: "Builder", roles: ["super_admin","admin","manager"] },
  { href: "/teams",     label: "AI Teams",          icon: "⌬", group: "Builder", roles: ["super_admin","admin","manager"] },
  { href: "/scripts",   label: "Scripts",           icon: "✎", group: "Builder", roles: ["super_admin","admin","manager"] },
  { href: "/voices",    label: "Voice Studio",      icon: "♪", group: "Builder", roles: ["super_admin","admin","manager"] },
  { href: "/flows",     label: "Flows / IVR",       icon: "❖", group: "Builder", roles: ["super_admin","admin","manager"] },
  { href: "/workflows", label: "Workflows n8n",     icon: "⇄", group: "Builder", roles: ["super_admin","admin","manager"] },
  { href: "/documents", label: "Documents (RAG)",   icon: "≣", group: "Builder", roles: ["super_admin","admin","manager"] },
  { href: "/analyses",  label: "LLM Analysis",      icon: "∑", group: "Builder", roles: ["super_admin","admin","manager"] },

  // ── CRM ──
  { href: "/contacts",  label: "Contacts",          icon: "◐", group: "CRM" },
  { href: "/numbers",   label: "Numbers",           icon: "✆", group: "CRM", roles: ["super_admin","admin","manager"] },
  { href: "/numbers/health", label: "Number health", icon: "♥", group: "CRM", roles: ["super_admin","admin","manager"] },

  // ── Admin ──
  { href: "/admin",          label: "Administration",       icon: "★", group: "Admin", roles: ["super_admin","admin"] },
  { href: "/admin/copilot",  label: "Super Admin Copilot",  icon: "✦", group: "Admin", roles: ["super_admin"] },
  { href: "/admin/inbound",  label: "Inbound connectors",   icon: "⇩", group: "Admin", roles: ["super_admin","admin"] },
  { href: "/admin/billing",  label: "Billing",              icon: "€", group: "Admin", roles: ["super_admin","admin"] },
  { href: "/admin/compliance", label: "Compliance (DNC)",   icon: "⊘", group: "Admin", roles: ["super_admin","admin","manager"] },
  { href: "/settings",       label: "Settings",             icon: "⚙", group: "Admin", roles: ["super_admin","admin","manager"] },

  // ── Help (accessible to everyone) ──
  { href: "/help",           label: "Guide",                icon: "?", group: "Help" },
];

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const [role, setRole] = useState<Role | null>(null);
  const [loadedRole, setLoadedRole] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then((res: { data: { user: { id?: string } | null } }) => {
      if (!res.data.user) {
        setLoadedRole(true);
        return;
      }
      sb.from("memberships")
        .select("role")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
        .then((mr: { data: { role?: string } | null }) => {
          setRole((mr.data?.role as Role) ?? "agent");
          setLoadedRole(true);
        });
    });
  }, []);

  const visible = NAV.filter((n) => {
    if (!loadedRole || !role) return true; // pre-load: show everything to avoid flicker
    if (!n.roles || n.roles.length === 0) return true;
    return n.roles.includes(role);
  });

  const groups: Record<string, NavItem[]> = {};
  for (const item of visible) {
    (groups[item.group] ??= []).push(item);
  }

  return (
    <nav className="sidebar">
      <Link href="/" className="brand">
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
              n.href === "/"
                ? pathname === "/"
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
        {loadedRole && role && (
          <div style={{ padding: "6px 12px", fontSize: 10, color: "var(--muted-2)" }}>
            role: <span className="kbd" style={{ fontSize: 10 }}>{role}</span>
          </div>
        )}
        <OrgSwitcher />
        <div style={{ padding: "10px 12px", color: "var(--muted-2)", fontSize: 11 }}>
          Axon Voice Platform · v2
        </div>
      </div>
    </nav>
  );
}
