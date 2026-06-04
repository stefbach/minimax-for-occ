"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "./brand/Brand";
import { OrgSwitcher } from "./OrgSwitcher";
import { ThemeLangSwitcher } from "./ThemeLangSwitcher";
import { useT } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { effectiveModules, isModuleId, type ModuleId } from "@/lib/permissions";

// Width below which the sidebar morphs into a slide-in drawer. Kept in sync
// with the `.mobile-nav-toggle` media query in globals.css.
const MOBILE_BREAKPOINT = 980;

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
  /** Which module this entry belongs to. Items without a module are visible
   *  to every authenticated user (e.g. /start, /help). Visibility is now
   *  computed via effectiveModules(role, visible_modules) — the owner can
   *  subtract specific modules per-user via memberships.visible_modules. */
  module?: ModuleId;
  /** Optional fine-grained role gate. Use when an entry sits inside a
   *  module that ALL roles can see but should itself be restricted (e.g.
   *  the supervisor sub-view of /desk). super_admin always passes. */
  requiredRoles?: Role[];
  /** True = lives under the collapsible "Avancé" section (not yet folded into
   *  its parent page). Removed from there as later phases relocate it. */
  advanced?: boolean;
}

// Roles allowed to see the supervisor-only entries. Mirrors the
// server-side gate in /api/desk/tasks/:id/reassign.
const SUPERVISOR_ROLES: Role[] = ["super_admin", "owner", "admin", "manager", "supervisor"];

const NAV: NavItem[] = [
  // ─── OVERVIEW ───
  { href: "/start",     label: "Démarrage guidé",  icon: "✦", group: "Overview" },
  { href: "/dashboard", label: "Tableau d'analyse", icon: "▣", group: "Overview", module: "dashboard" },
  { href: "/copilot",   label: "Co-pilot manager", icon: "✸", group: "Overview", module: "copilot" },
  { href: "/desk",      label: "Mon poste",        icon: "⌂", group: "Overview", module: "desk" },
  { href: "/alerts",    label: "Alertes",          icon: "!", group: "Overview", module: "alerts" },

  // ─── CONFIGURATION ───
  { href: "/agents",         label: "Agents",                icon: "◇", group: "Configuration", module: "agents" },
  { href: "/teams",          label: "Teams IA",              icon: "⌬", group: "Configuration", module: "agents" },
  { href: "/scripts",        label: "Scripts",               icon: "✎", group: "Configuration", module: "agents" },
  { href: "/agents/library", label: "Bibliothèque persona", icon: "⊕", group: "Configuration", module: "agents" },
  { href: "/voices",         label: "Voice Studio",          icon: "♪", group: "Configuration", module: "agents" },

  // ─── OPÉRATIONS ───
  { href: "/campaigns", label: "Campagnes",      icon: "⇈", group: "Opérations", module: "campaigns" },
  { href: "/calls",     label: "Appels",         icon: "☎", group: "Opérations", module: "calls" },
  { href: "/workflows", label: "Automatisation", icon: "⇄", group: "Opérations", module: "workflows" },
  { href: "/flows",     label: "Flows / IVR",    icon: "❖", group: "Opérations", module: "flows" },
  { href: "/queues",    label: "Files d'attente", icon: "≡", group: "Opérations", module: "queues" },
  // Supervision of the "Appels du jour" task list — sits as a sibling to
  // /desk so it's intuitive for managers. Uses the desk module for
  // visibility AND the requiredRoles fine-grained gate (since /desk
  // itself is open to agents).
  { href: "/desk/supervise", label: "Supervision Appels du jour", icon: "◷", group: "Opérations", module: "desk", requiredRoles: SUPERVISOR_ROLES },

  // ─── DONNÉES ───
  { href: "/contacts",       label: "CRM / Contacts",      icon: "◐", group: "Données", module: "contacts" },
  { href: "/numbers",        label: "Numéros de téléphone", icon: "✆", group: "Données", module: "numbers" },
  { href: "/numbers/health", label: "Santé des numéros",   icon: "♥", group: "Données", module: "numbers" },

  // ─── COMPTE ───
  { href: "/team",      label: "Équipe",          icon: "◉", group: "Compte", module: "team" },
  { href: "/settings",  label: "Paramètres",      icon: "⚙", group: "Compte", module: "settings" },
  { href: "/help",      label: "Guide",           icon: "?", group: "Compte" },
];

// Render order for the primary groups. The "Avancé" collapsible section is
// fully retired — every advanced page now lives in its proper functional group.
const GROUP_ORDER = ["Overview", "Configuration", "Opérations", "Données", "Compte"];

export function ClientSidebar() {
  const t = useT();
  const pathname = usePathname() ?? "/";
  const [role, setRole] = useState<Role | null>(null);
  const [visibleModules, setVisibleModules] = useState<ModuleId[] | null>(null);
  const [loadedRole, setLoadedRole] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Mobile drawer state — only meaningful below MOBILE_BREAKPOINT; ignored
  // by the CSS on desktop where the sidebar is permanently visible.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever the route changes — otherwise a user who taps a
  // nav link sees the overlay linger on top of the destination page.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Re-snap to "closed" when the viewport crosses the breakpoint upward, so
  // returning to desktop never leaves a stale `.open` class around.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px)`);
    const onChange = () => {
      if (mq.matches) setDrawerOpen(false);
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Lock body scroll while the drawer overlay is open — otherwise the page
  // behind continues to scroll under the user's finger.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (drawerOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [drawerOpen]);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then((res: { data: { user: { id?: string } | null } }) => {
      if (!res.data.user) {
        setLoadedRole(true);
        return;
      }
      sb.from("memberships")
        .select("role, visible_modules")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
        .then((mr: { data: { role?: string; visible_modules?: unknown } | null }) => {
          setRole((mr.data?.role as Role) ?? "agent");
          const vm = mr.data?.visible_modules;
          if (Array.isArray(vm)) {
            setVisibleModules((vm as unknown[]).filter(isModuleId) as ModuleId[]);
          } else {
            setVisibleModules(null);
          }
          setLoadedRole(true);
        });
    });
  }, []);

  const allowedModules = effectiveModules({ role, visible_modules: visibleModules });
  const canSee = (n: NavItem): boolean => {
    if (!loadedRole || !role) return true; // pre-load: show everything to avoid flicker
    if (n.module && !allowedModules.includes(n.module)) return false;
    if (n.requiredRoles && !n.requiredRoles.includes(role)) {
      // super_admin always passes (already in SUPERVISOR_ROLES, but guard
      // here too in case future entries forget to include it).
      if (role !== "super_admin") return false;
    }
    return true;
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
        onClick={() => setDrawerOpen(false)}
      >
        <span aria-hidden="true" style={{ width: 16, opacity: 0.7 }}>{n.icon}</span>
        <span>{t(n.label)}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Mobile-only hamburger. CSS keeps this hidden ≥980px so desktop is
          untouched; on phones/tablets it floats top-left and toggles the
          drawer. aria-expanded mirrors state for screen readers. */}
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-label={drawerOpen ? t("Fermer le menu") : t("Ouvrir le menu")}
        aria-expanded={drawerOpen}
        aria-controls="client-sidebar"
        onClick={() => setDrawerOpen((v) => !v)}
      >
        {drawerOpen ? "✕" : "☰"}
      </button>

      {/* Backdrop — tap-to-close. `display: none` by default; the media
          query in globals.css makes it `block` only on mobile when open. */}
      <div
        className={`mobile-nav-backdrop${drawerOpen ? " open" : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      <nav
        id="client-sidebar"
        className={`sidebar${drawerOpen ? " open" : ""}`}
        aria-label={t("Navigation principale")}
      >
      <Link href="/" className="brand" onClick={() => setDrawerOpen(false)}>
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
    </>
  );
}
