"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Brand } from "./brand/Brand";
import { OrgSwitcher } from "./OrgSwitcher";
import { ThemeLangSwitcher } from "./ThemeLangSwitcher";
import { useT } from "@/lib/i18n";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ChevronDown, Heart, Menu, Music, Pencil, Settings, X, Zap } from "lucide-react";
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
  icon: ReactNode;
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
  /** True = render as a visually-nested sub-item under the entry above it
   *  (indented, lighter). Used for "Calendrier IA" under "Mon calendrier". */
  indent?: boolean;
}

// Roles allowed to see the supervisor-only entries. Mirrors the
// server-side gate in /api/desk/tasks/:id/reassign.
const SUPERVISOR_ROLES: Role[] = ["super_admin", "owner", "admin", "manager", "supervisor"];
// Roles allowed to generate pilotage reports (calls funnel, qualif breakdown,
// vigilance, plan d'action) — managers and above. Supervisors stay out: their
// scope is live floor supervision, not strategic reporting.
const MANAGER_REPORT_ROLES: Role[] = ["super_admin", "owner", "admin", "manager"];
// Roles that should NOT see the raw call log / campaign config — they
// only need their personal task queue + calendar. Human agents fall
// here; supervisors fall through with everything visible.
const NON_AGENT_PAGES_FOR_AGENT_ROLE = new Set([
  "/calls", "/campaigns", "/agents", "/teams", "/scripts", "/agents/library",
  "/voices", "/workflows", "/flows", "/queues", "/numbers", "/numbers/health",
  "/copilot",
]);
// Pages retired June 10 (Wati): /calls is hidden from EVERY role's nav —
// the same data is in the Live tab of /dashboard and the Call Logs tab.
const RETIRED_PAGES = new Set(["/calls"]);

const NAV: NavItem[] = [
  // ─── APERÇU ───
  { href: "/start",     label: "Démarrage guidé",   icon: "✦", group: "Vue d'ensemble" },
  { href: "/dashboard", label: "Tableau d'analyse", icon: "▣", group: "Vue d'ensemble", module: "dashboard" },
  { href: "/copilot",   label: "Co-pilot manager",  icon: "✸", group: "Vue d'ensemble", module: "copilot" },
  { href: "/rapports",  label: "Rapports pilotage",  icon: "▤", group: "Vue d'ensemble", requiredRoles: MANAGER_REPORT_ROLES },
  { href: "/desk",            label: "Mon espace",      icon: "⌂", group: "Vue d'ensemble", module: "desk" },
  { href: "/mon-calendrier",  label: "Mon calendrier",  icon: "▦", group: "Vue d'ensemble", module: "desk" },
  { href: "/mon-calendrier/ia", label: "Calendrier IA", icon: "🤖", group: "Vue d'ensemble", module: "desk", indent: true },
  { href: "/desk/supervise",  label: "Supervision",     icon: "◷", group: "Vue d'ensemble", module: "desk", requiredRoles: SUPERVISOR_ROLES },
  { href: "/supervise/live",  label: "Supervision live", icon: "◉", group: "Vue d'ensemble", module: "desk", requiredRoles: SUPERVISOR_ROLES },
  { href: "/mes-patients",    label: "Mes patients",    icon: <Menu size={16} />, group: "Vue d'ensemble", module: "desk" },
  { href: "/alerts",    label: "Alertes",           icon: "!", group: "Vue d'ensemble", module: "alerts" },

  // ─── CONFIGURATION ───
  { href: "/agents",         label: "Agents",                icon: "◇", group: "Configuration", module: "agents" },
  { href: "/outbound-call",  label: "Appel sortant",         icon: "☎", group: "Configuration", module: "agents" },
  { href: "/teams",          label: "Teams IA",              icon: "⌬", group: "Configuration", module: "agents" },
  { href: "/scripts",        label: "Scripts",               icon: <Pencil size={16} />, group: "Configuration", module: "agents" },
  { href: "/agents/library", label: "Bibliothèque persona",  icon: "⊕", group: "Configuration", module: "agents" },
  { href: "/voices",         label: "Voice Studio",          icon: <Music size={16} />, group: "Configuration", module: "agents" },

  // ─── OPÉRATIONS ───
  { href: "/campaigns", label: "Campagnes",      icon: "⇈", group: "Opérations", module: "campaigns" },
  // /calls retired June 10 — the same info lives in the Live tab of the
  // dashboard and the Call Logs tab. Keeping the route reachable (for
  // legacy bookmarks) but hidden from nav. NON_AGENT_PAGES_FOR_AGENT_ROLE
  // also gates it.
  { href: "/workflows", label: "Automatisation", icon: "⇄", group: "Opérations", module: "workflows" },
  { href: "/flows",     label: "Flows / IVR",    icon: "❖", group: "Opérations", module: "flows" },
  { href: "/queues",    label: "Files d'attente", icon: "≡", group: "Opérations", module: "queues" },

  // ─── DONNÉES ───
  { href: "/contacts",       label: "CRM / Contacts",       icon: "◐", group: "Données", module: "contacts" },
  { href: "/numbers",        label: "Numéros de téléphone", icon: "✆", group: "Données", module: "numbers" },
  { href: "/numbers/health", label: "Santé des numéros",    icon: <Heart size={16} />, group: "Données", module: "numbers" },

  // ─── COMPTE ───
  { href: "/team",      label: "Équipe",          icon: "◉", group: "Compte", module: "team" },
  { href: "/settings",  label: "Paramètres",      icon: <Settings size={16} />, group: "Compte", module: "settings" },
  { href: "/help",      label: "Guide",            icon: "?", group: "Compte" },
];

// Render order for the primary groups. The "Avancé" collapsible section is
// fully retired — every advanced page now lives in its proper functional group.
const GROUP_ORDER = ["Vue d'ensemble", "Configuration", "Opérations", "Données", "Compte"];

export function ClientSidebar() {
  const t = useT();
  const pathname = usePathname() ?? "/";
  const [role, setRole] = useState<Role | null>(null);
  const [visibleModules, setVisibleModules] = useState<ModuleId[] | null>(null);
  const [loadedRole, setLoadedRole] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Collapsed groups — set of group names folded by the user. Persisted in localStorage.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Mobile drawer state — only meaningful below MOBILE_BREAKPOINT; ignored
  // by the CSS on desktop where the sidebar is permanently visible.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      const storedGroups = localStorage.getItem("sidebar-collapsed-groups");
      if (storedGroups) setCollapsedGroups(new Set(JSON.parse(storedGroups)));
    } catch { /* ignore */ }
  }, []);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      localStorage.setItem("sidebar-collapsed-groups", JSON.stringify([...next]));
      return next;
    });
  };

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

  // /desk badge — poll the lightweight task counter so the agent sees a red
  // bubble on "Mon poste" the moment a new A PASSER A L'HUMAIN comes in
  // (mine + pool). 30 s is short enough to feel live without hammering the
  // DB. Silently ignores failures (no badge when offline / unauthenticated).
  const [deskBadge, setDeskBadge] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/desk/tasks/count", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { total?: number };
        if (!cancelled) setDeskBadge(Number(j?.total ?? 0));
      } catch {
        /* swallow */
      }
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
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
    // Pure 'agent' role: hide the operational/config pages that only
    // matter to managers/supervisors (campaigns, calls log, scripts,
    // numbers, etc.) — agents should see their own queue + calendar +
    // patients only. Wati June 10: '/calls n'a aucun sens chez agent'.
    if (role === "agent" && NON_AGENT_PAGES_FOR_AGENT_ROLE.has(n.href)) return false;
    if (RETIRED_PAGES.has(n.href)) return false;
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
        : pathname === n.href ||
          // "most specific wins": a parent (e.g. /mon-calendrier) is NOT
          // highlighted when a longer child route (/mon-calendrier/ia) matches.
          (pathname.startsWith(n.href + "/") &&
            !visible.some(
              (o) =>
                o.href !== n.href &&
                o.href.length > n.href.length &&
                (pathname === o.href || pathname.startsWith(o.href + "/")),
            ));
    return (
      <Link
        key={n.href}
        href={n.href}
        className={`nav-link ${active ? "active" : ""}`}
        aria-label={n.label}
        title={undefined}
        aria-current={active ? "page" : undefined}
        onClick={() => setDrawerOpen(false)}
        style={n.indent ? { paddingLeft: 30 } : undefined}
      >
        <span aria-hidden="true" style={{ width: 16, opacity: 0.7, fontSize: n.indent ? 12 : undefined, flexShrink: 0 }}>{n.icon}</span>
        <span className="sidebar-label" style={{ flex: 1, fontSize: n.indent ? 13 : undefined, opacity: n.indent && !active ? 0.85 : undefined }}>{t(n.label)}</span>
        {n.href === "/desk" && deskBadge > 0 ? (
          <span
            className="sidebar-label"
            aria-label={`${deskBadge} pending task${deskBadge > 1 ? "s" : ""}`}
            style={{
              minWidth: 20,
              padding: "0 6px",
              borderRadius: 10,
              background: "#dc2626",
              color: "white",
              fontSize: 11,
              fontWeight: 600,
              textAlign: "center",
              lineHeight: "18px",
              marginLeft: 6,
            }}
          >
            {deskBadge > 99 ? "99+" : deskBadge}
          </span>
        ) : null}
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
        {drawerOpen ? <X size={16} /> : <Menu size={16} />}
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
        {/* ── Header: brand + theme switcher ── */}
        <div className="sidebar-header">
          <Link href="/" className="brand" onClick={() => setDrawerOpen(false)}>
            <Brand size={18} />
          </Link>
          <div className="sidebar-theme-row">
            <ThemeLangSwitcher />
          </div>
        </div>

        {/* ── Scrollable nav groups ── */}
        <div className="sidebar-nav">
          {GROUP_ORDER.filter((g) => groups[g]?.length).map((group) => {
            const isGroupCollapsed = collapsedGroups.has(group);
            return (
              <div key={group} className="sidebar-group">
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="sidebar-group-btn"
                  aria-expanded={!isGroupCollapsed}
                >
                  <span>{t(group)}</span>
                  <ChevronDown
                    size={12}
                    style={{
                      transition: "transform 0.2s",
                      transform: isGroupCollapsed ? "rotate(-90deg)" : "none",
                      flexShrink: 0,
                    }}
                  />
                </button>
                {!isGroupCollapsed && (
                  <div className="sidebar-group-items">
                    {groups[group].map(renderLink)}
                  </div>
                )}
              </div>
            );
          })}

          {/* ─── Avancé (collapsible) ─── */}
          {advanced.length > 0 && (
            <div className="sidebar-group">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="sidebar-group-btn"
                aria-expanded={advancedOpen}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Settings size={11} style={{ opacity: 0.7 }} />
                  <span>Advanced</span>
                  <span className="sidebar-badge">{advanced.length}</span>
                </span>
                <ChevronDown
                  size={12}
                  style={{
                    transition: "transform 0.2s",
                    transform: advancedOpen ? "none" : "rotate(-90deg)",
                    flexShrink: 0,
                  }}
                />
              </button>
              {advancedOpen && (
                <div className="sidebar-group-items">
                  {advanced.map(renderLink)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Pinned footer ── */}
        <div className="sidebar-footer">
          {loadedRole && role === "super_admin" && (
            <Link
              href="/admin"
              aria-label="Switch to Axon admin mode"
              className="sidebar-admin-link"
            >
              <Zap size={13} aria-hidden="true" />
              <span>Axon admin mode</span>
            </Link>
          )}
          <OrgSwitcher />
          <div className="sidebar-footer-meta">
            {loadedRole && role && (
              <span className="kbd" style={{ fontSize: 10 }}>{role}</span>
            )}
            <span style={{ fontSize: 11, color: "var(--muted-2)" }}>Axon · v2</span>
          </div>
        </div>
      </nav>
    </>
  );
}
