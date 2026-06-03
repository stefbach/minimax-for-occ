"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "./brand/Brand";
import { OrgSwitcher } from "./OrgSwitcher";
import { ThemeLangSwitcher } from "./ThemeLangSwitcher";
import { useT } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Role =
  | "super_admin"
  | "admin"
  | "owner"
  | "manager"
  | "supervisor"
  | "builder"
  | "agent"
  | "analyst"
  | "viewer";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  group: string;
  /** Which roles can see this entry. Empty/omitted = everyone. */
  roles?: Role[];
  /** True = lives under the collapsible "Avancé" section (not yet folded into
   *  its parent page). Removed from there as later phases relocate it. */
  advanced?: boolean;
}

// Reusable role buckets.
const MGMT: Role[] = ["super_admin", "admin", "owner", "manager"];
const OPS: Role[] = ["super_admin", "admin", "owner", "manager", "supervisor", "analyst", "viewer"];

const NAV: NavItem[] = [
  // ─── OVERVIEW ───
  { href: "/start",     label: "Démarrage guidé", icon: "✦", group: "Overview" },
  { href: "/dashboard", label: "Tableau d'analyse", icon: "▣", group: "Overview" },
  { href: "/desk",      label: "Mon poste",       icon: "⌂", group: "Overview" }, // all roles — anyone may take a call

  // ─── CONFIGURATION ───
  { href: "/agents",    label: "Agents",          icon: "◇", group: "Configuration", roles: MGMT },
  { href: "/teams",     label: "Teams IA",        icon: "⌬", group: "Configuration", roles: MGMT },
  { href: "/scripts",   label: "Scripts",         icon: "✎", group: "Configuration", roles: MGMT },

  // ─── OPÉRATIONS ───
  { href: "/campaigns", label: "Campagnes",       icon: "⇈", group: "Opérations", roles: MGMT },
  { href: "/calls",     label: "Appels",          icon: "☎", group: "Opérations", roles: OPS },
  { href: "/workflows", label: "Workflows n8n",   icon: "⇄", group: "Opérations", roles: MGMT },

  // ─── DONNÉES ───
  { href: "/contacts",  label: "CRM / Contacts",  icon: "◐", group: "Données" },

  // ─── COMPTE ───
  { href: "/settings",  label: "Paramètres",      icon: "⚙", group: "Compte", roles: MGMT },
  { href: "/help",      label: "Guide",           icon: "?", group: "Compte" },

  // ─── AVANCÉ (collapsible — pages not yet folded into their parent) ───
  // Phase 2 → into Agents:
  { href: "/voices",         label: "Voice Studio (→ Agents)",       icon: "♪", group: "Avancé", roles: MGMT, advanced: true },
  { href: "/agents/library", label: "Bibliothèque persona (→ Agents)", icon: "⊕", group: "Avancé", roles: MGMT, advanced: true },
  { href: "/documents",      label: "Documents RAG (→ Agents)",      icon: "≣", group: "Avancé", roles: MGMT, advanced: true },
  // Phase 4 → into Appels:
  { href: "/queues",         label: "Files d'attente (→ Appels)",    icon: "≡", group: "Avancé", roles: OPS,  advanced: true },
  // Phase 5 → into Dashboard / Rapports:
  { href: "/analytics",      label: "Analytics (→ Dashboard)",       icon: "▤", group: "Avancé", roles: OPS,  advanced: true },
  { href: "/analyses",       label: "Analyses LLM (→ Rapports)",     icon: "∑", group: "Avancé", roles: MGMT, advanced: true },
  { href: "/alerts",         label: "Alertes (→ Dashboard)",         icon: "!", group: "Avancé", roles: OPS,  advanced: true },
  // Phase 6 → into Paramètres:
  { href: "/numbers",        label: "Numéros (→ Paramètres)",        icon: "✆", group: "Avancé", roles: MGMT, advanced: true },
  { href: "/numbers/health", label: "Santé numéros (→ Paramètres)",  icon: "♥", group: "Avancé", roles: MGMT, advanced: true },
  { href: "/flows",          label: "Flows / IVR (avancé)",          icon: "❖", group: "Avancé", roles: MGMT, advanced: true },
];

// Render order for the primary (non-advanced) groups.
const GROUP_ORDER = ["Overview", "Configuration", "Opérations", "Données", "Compte"];

export function ClientSidebar() {
  const t = useT();
  const pathname = usePathname() ?? "/";
  const [role, setRole] = useState<Role | null>(null);
  const [loadedRole, setLoadedRole] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  const canSee = (n: NavItem): boolean => {
    if (!loadedRole || !role) return true; // pre-load: show everything to avoid flicker
    if (!n.roles || n.roles.length === 0) return true;
    return n.roles.includes(role);
  };

  const visible = NAV.filter(canSee);
  const primary = visible.filter((n) => !n.advanced);
  const advanced = visible.filter((n) => n.advanced);

  const groups: Record<string, NavItem[]> = {};
  for (const item of primary) {
    (groups[item.group] ??= []).push(item);
  }

  const renderLink = (n: NavItem) => {
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
        <span>{t(n.label)}</span>
      </Link>
    );
  };

  return (
    <nav className="sidebar">
      <Link href="/" className="brand">
        <Brand size={18} />
      </Link>

      <div style={{ marginTop: 10, marginBottom: 4, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
        <ThemeLangSwitcher />
      </div>

      {GROUP_ORDER.filter((g) => groups[g]?.length).map((group) => (
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
            {t(group)}
          </div>
          {groups[group].map(renderLink)}
        </div>
      ))}

      {/* ─── Avancé (collapsible) ─── */}
      {advanced.length > 0 && (
        <div style={{ marginTop: 10, padding: "0 10px" }}>
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              color: "var(--fg, #e5e5e5)",
              background: "var(--surface-2, rgba(255,255,255,0.04))",
              border: "1px solid var(--border, #2a2a2a)",
              borderRadius: 8,
              padding: "9px 12px",
              textAlign: "left",
            }}
            aria-expanded={advancedOpen}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden="true" style={{ fontSize: 12, opacity: 0.7 }}>⚙</span>
              <span>Avancé</span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--muted-2)",
                  background: "var(--surface-3, rgba(255,255,255,0.08))",
                  borderRadius: 10,
                  padding: "1px 7px",
                }}
              >
                {advanced.length}
              </span>
            </span>
            <span aria-hidden="true" style={{ fontSize: 14, opacity: 0.8, transition: "transform 0.15s", transform: advancedOpen ? "rotate(90deg)" : "none" }}>
              ›
            </span>
          </button>
          {advancedOpen && <div style={{ marginTop: 4 }}>{advanced.map(renderLink)}</div>}
        </div>
      )}

      <div style={{ marginTop: "auto" }}>
        {/* Super-admin: jump to the Axon admin app — made prominent */}
        {loadedRole && role === "super_admin" && (
          <div style={{ padding: "8px 10px 4px" }}>
            <Link
              href="/admin"
              aria-label="Basculer en mode admin Axon"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--accent, #ff6b35)",
                border: "1px solid var(--accent, #ff6b35)",
                borderRadius: 8,
                textDecoration: "none",
                justifyContent: "center",
              }}
            >
              <span aria-hidden="true">⚡</span>
              <span>Mode admin Axon</span>
            </Link>
          </div>
        )}

        {/* Org switcher (renders its own "Organisation" label, email + Quitter). */}
        <OrgSwitcher />

        {/* Role + version footer line. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
          }}
        >
          {loadedRole && role ? (
            <span className="kbd" style={{ fontSize: 11 }}>{role}</span>
          ) : (
            <span />
          )}
          <span style={{ fontSize: 11, color: "var(--muted-2)" }}>Axon · v2</span>
        </div>
      </div>
    </nav>
  );
}
