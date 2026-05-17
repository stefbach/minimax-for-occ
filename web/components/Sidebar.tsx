"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./brand/Brand";
import { OrgSwitcher } from "./OrgSwitcher";

const NAV: Array<{
  href: string;
  label: string;
  icon: string;
  phase?: string;
  group?: string;
}> = [
  { href: "/",          label: "Accueil",          icon: "◎", group: "Overview" },
  { href: "/calls",     label: "Appels (live)",    icon: "☎", phase: "phase 1", group: "Operations" },
  { href: "/desk",      label: "Mon poste",        icon: "⌂", phase: "phase 3", group: "Operations" },
  { href: "/queues",    label: "Files d'attente",  icon: "≡", phase: "phase 1", group: "Operations" },
  { href: "/campaigns", label: "Campagnes",        icon: "⇈", phase: "phase 5", group: "Operations" },

  { href: "/agents",    label: "Agents IA",        icon: "◇", group: "Builder" },
  { href: "/voices",    label: "Voice Studio",     icon: "♪", group: "Builder" },
  { href: "/flows",     label: "Flows / IVR",      icon: "❖", group: "Builder" },
  { href: "/workflows", label: "Workflows n8n",    icon: "⇄", group: "Builder" },
  { href: "/documents", label: "Documents (RAG)",  icon: "≣", group: "Builder" },

  { href: "/contacts",  label: "Contacts",         icon: "◐", group: "CRM" },
  { href: "/numbers",   label: "Numéros",          icon: "✆", phase: "phase 1", group: "CRM" },

  { href: "/settings",  label: "Paramètres",       icon: "⚙", group: "Admin" },
];

export function Sidebar() {
  const pathname = usePathname() ?? "/";

  // Render nav grouped by `group`, preserving the array order for groups.
  const groups: Record<string, typeof NAV> = {};
  for (const item of NAV) {
    const g = item.group ?? "—";
    (groups[g] ??= []).push(item);
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
                style={{ position: "relative" }}
              >
                <span aria-hidden="true" style={{ width: 16, opacity: 0.7 }}>{n.icon}</span>
                <span>{n.label}</span>
                {n.phase && (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 9,
                      color: "var(--muted-2)",
                      border: "1px solid var(--border)",
                      padding: "1px 5px",
                      borderRadius: 4,
                    }}
                  >
                    {n.phase}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}

      <div style={{ marginTop: "auto" }}>
        <OrgSwitcher />
        <div style={{ padding: "10px 12px", color: "var(--muted-2)", fontSize: 11 }}>
          Axon Voice Platform · v2
        </div>
      </div>
    </nav>
  );
}
