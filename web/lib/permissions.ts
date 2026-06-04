// Per-user granular module visibility.
//
// Module identifiers are stable strings shared between the DB (the
// `memberships.visible_modules` JSON array), the middleware, the sidebar and
// the API guards. The DEFAULT visibility per role lives here too — when a
// membership has `visible_modules = NULL` the user inherits the role default;
// when it is set, it OVERRIDES the default and the user sees ONLY those ids.

export const MODULE_IDS = [
  "dashboard",
  "copilot",
  "desk",
  "alerts",
  "agents",
  "campaigns",
  "calls",
  "workflows",
  "flows",
  "queues",
  "contacts",
  "numbers",
  "team",
  "settings",
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

const MODULE_ID_SET: ReadonlySet<string> = new Set(MODULE_IDS);

/** True when `m` is a valid module id (type-guard / runtime check). */
export function isModuleId(m: unknown): m is ModuleId {
  return typeof m === "string" && MODULE_ID_SET.has(m);
}

export const MODULE_LABELS: Record<ModuleId, string> = {
  dashboard: "Tableau d'analyse",
  copilot:   "Co-pilot manager",
  desk:      "Mon poste",
  alerts:    "Alertes",
  agents:    "Agents IA (config)",
  campaigns: "Campagnes",
  calls:     "Appels",
  workflows: "Automatisation",
  flows:     "Flows / IVR",
  queues:    "Files d'attente",
  contacts:  "CRM / Contacts",
  numbers:   "Numéros de téléphone",
  team:      "Équipe",
  settings:  "Paramètres",
};

// Role → default modules. Tuned to match what each role sees TODAY (before
// the visible_modules override existed) so flipping a membership from
// NULL → an explicit array is the only thing that changes behaviour.
const ALL_MODULES: readonly ModuleId[] = MODULE_IDS;
const MANAGER_MODULES: readonly ModuleId[] = [
  "dashboard", "copilot", "desk", "alerts", "agents", "campaigns",
  "calls", "workflows", "flows", "queues", "contacts", "numbers",
];
const SUPERVISOR_MODULES: readonly ModuleId[] = [
  "dashboard", "alerts", "desk", "calls", "queues", "contacts",
];
const AGENT_MODULES: readonly ModuleId[] = [
  "dashboard", "desk", "calls", "contacts",
];
const READONLY_MODULES: readonly ModuleId[] = [
  "dashboard", "calls", "contacts",
];
const BUILDER_MODULES: readonly ModuleId[] = [
  "agents", "flows", "workflows",
];

export function defaultModulesForRole(role: string | null | undefined): ModuleId[] {
  switch (role) {
    case "owner":
    case "admin":
    case "super_admin":
      return [...ALL_MODULES];
    case "manager":
      return [...MANAGER_MODULES];
    case "supervisor":
      return [...SUPERVISOR_MODULES];
    case "agent":
      return [...AGENT_MODULES];
    case "viewer":
    case "analyst":
      return [...READONLY_MODULES];
    case "builder":
      return [...BUILDER_MODULES];
    default:
      // Unknown / null role: be conservative and grant the bare minimum.
      return [...READONLY_MODULES];
  }
}

/**
 * Effective module list for a user.
 *   - super_admin always sees everything (platform bypass).
 *   - `visible_modules` (when non-null AND non-empty) overrides the default
 *     and is intersected with MODULE_IDS to reject stale ids.
 *   - Otherwise the role default is returned.
 */
export function effectiveModules(opts: {
  role: string | null | undefined;
  visible_modules?: ModuleId[] | string[] | null;
}): ModuleId[] {
  if (opts.role === "super_admin") return [...ALL_MODULES];
  const vm = opts.visible_modules;
  if (Array.isArray(vm) && vm.length > 0) {
    const filtered: ModuleId[] = (vm as unknown[]).filter(isModuleId);
    if (filtered.length > 0) return filtered;
  }
  return defaultModulesForRole(opts.role);
}

export function hasModule(
  opts: { role: string | null | undefined; visible_modules?: ModuleId[] | string[] | null },
  m: ModuleId,
): boolean {
  return effectiveModules(opts).includes(m);
}

/**
 * Map a URL pathname to a module id. Returns null for paths that are open
 * to every authenticated user (start, help, login, …) so the gate stays
 * permissive for them.
 *
 * The longest matching prefix wins, so `/numbers/health` correctly resolves
 * to `numbers` and `/agents/123/edit` to `agents`.
 */
const PATH_PREFIXES: Array<readonly [string, ModuleId]> = [
  ["/dashboard", "dashboard"],
  ["/analytics", "dashboard"],
  ["/copilot",   "copilot"],
  ["/desk",      "desk"],
  ["/alerts",    "alerts"],
  ["/agents",    "agents"],
  ["/teams",     "agents"],   // "Teams IA" lives under the agents module
  ["/scripts",   "agents"],
  ["/voices",    "agents"],
  ["/campaigns", "campaigns"],
  ["/calls",     "calls"],
  ["/workflows", "workflows"],
  ["/flows",     "flows"],
  ["/queues",    "queues"],
  ["/contacts",  "contacts"],
  ["/numbers",   "numbers"],
  ["/team",      "team"],
  ["/settings",  "settings"],
];

export function pathToModule(pathname: string): ModuleId | null {
  let best: ModuleId | null = null;
  let bestLen = 0;
  for (const [prefix, mod] of PATH_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      if (prefix.length > bestLen) {
        best = mod;
        bestLen = prefix.length;
      }
    }
  }
  return best;
}
