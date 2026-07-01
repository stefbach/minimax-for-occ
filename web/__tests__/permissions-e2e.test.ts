import { describe, it, expect } from "vitest";
import {
  effectiveModules,
  hasModule,
  pathToModule,
  MODULE_IDS,
  type ModuleId,
} from "@/lib/permissions";

/**
 * Wave B permission verification — end-to-end of the pure logic layer.
 *
 * These tests don't spin up Next or Supabase. They exercise
 * `effectiveModules`, `hasModule`, and `pathToModule` against the realistic
 * role × visible_modules combinations that the sidebar, the middleware and
 * the API guards all rely on.
 *
 * The fan-out matches the deliverable spec verbatim — adjustments to the
 * policy must update both this suite and the relevant docs.
 */

describe("effectiveModules — role defaults + per-user override", () => {
  it("agent role, no override -> dashboard + desk + calls + contacts only", () => {
    const mods = effectiveModules({ role: "agent", visible_modules: null });
    expect(new Set(mods)).toEqual(new Set(["dashboard", "desk", "calls", "contacts"]));
    // Negative: the heavy modules stay hidden.
    for (const m of ["agents", "campaigns", "team", "settings"] as ModuleId[]) {
      expect(mods).not.toContain(m);
    }
  });

  it("agent role with visible_modules=['desk'] -> ONLY desk", () => {
    const mods = effectiveModules({ role: "agent", visible_modules: ["desk"] });
    expect(mods).toEqual(["desk"]);
    expect(hasModule({ role: "agent", visible_modules: ["desk"] }, "calls")).toBe(false);
  });

  it("owner role, no override -> sees everything (14 modules)", () => {
    const mods = effectiveModules({ role: "owner", visible_modules: null });
    expect(mods.length).toBe(MODULE_IDS.length);
    expect(new Set(mods)).toEqual(new Set(MODULE_IDS));
  });

  it("owner role with visible_modules=['desk'] -> ONLY desk (override wins for owner)", () => {
    const mods = effectiveModules({ role: "owner", visible_modules: ["desk"] });
    expect(mods).toEqual(["desk"]);
    // Owner-restricted accounts cannot bypass via hasModule either.
    expect(hasModule({ role: "owner", visible_modules: ["desk"] }, "dashboard")).toBe(false);
    expect(hasModule({ role: "owner", visible_modules: ["desk"] }, "settings")).toBe(false);
  });

  it("super_admin -> bypasses module gating entirely (any module check returns true)", () => {
    // Even an explicit, restrictive visible_modules is ignored for the
    // platform-staff super_admin role.
    for (const m of MODULE_IDS) {
      expect(hasModule({ role: "super_admin", visible_modules: ["desk"] }, m)).toBe(true);
      expect(hasModule({ role: "super_admin", visible_modules: null }, m)).toBe(true);
    }
  });

  it("manager role, no override -> 13 default modules (settings included, no team)", () => {
    const mods = effectiveModules({ role: "manager", visible_modules: null });
    expect(mods.length).toBe(13);
    expect(mods).not.toContain("team");
    expect(mods).toContain("settings");
    // Spot-check the managerial workhorses are present.
    for (const m of ["dashboard", "campaigns", "agents", "calls"] as ModuleId[]) {
      expect(mods).toContain(m);
    }
  });

  it("viewer role with visible_modules=[] (empty array) -> falls back to role default (empty = 'use default')", () => {
    // Empty array is treated as "no override" by effectiveModules — the
    // sidebar/middleware reads it as "use the role default", NOT as "lock
    // the user out". This documents the intentional policy: to lock a user
    // out, persist visible_modules=[<single-module-they-keep>] or move
    // them to the viewer-equivalent of read-only. Setting [] would
    // otherwise create stranded accounts during admin edits.
    const mods = effectiveModules({ role: "viewer", visible_modules: [] });
    // viewer default = dashboard + calls + contacts
    expect(new Set(mods)).toEqual(new Set(["dashboard", "calls", "contacts"]));
  });
});

describe("pathToModule — URL prefix mapping", () => {
  const cases: Array<[string, ModuleId | null]> = [
    ["/dashboard", "dashboard"],
    ["/desk", "desk"],
    ["/desk/supervise", "desk"],
    ["/agents/123/edit", "agents"],
    ["/numbers/health", "numbers"],
    ["/team/invite", "team"],
    ["/login", null],
    ["/api/foo", null],
  ];
  for (const [path, expected] of cases) {
    it(`pathToModule('${path}') = ${expected ?? "null"}`, () => {
      expect(pathToModule(path)).toBe(expected);
    });
  }
});

/**
 * Integration test for the dashboard overview endpoint — gated through
 * requireModule(orgId, "dashboard").
 *
 * The route handler imports supabase + Next types at module load time; the
 * cheapest way to assert end-to-end gating without spinning up Next is to
 * mock the supabase clients before importing the route, then call its GET.
 *
 * Two scenarios:
 *   - agent role + visible_modules=null  → role default includes
 *     'dashboard', should be allowed (200 path).
 *   - agent role + visible_modules=['desk'] → override locks dashboard out,
 *     should return 403 with the documented error shape.
 */

describe("integration: /api/dashboard/overview gating via requireModule", () => {
  it("agent + visible_modules=null => 200 (dashboard is in role default)", async () => {
    const { runOverview } = await loadOverviewHandler({
      role: "agent",
      visible_modules: null,
    });
    const res = await runOverview();
    // We only assert the gate let the call through — when allowed the
    // handler may still 500 because we stub out half the data, but it must
    // NOT be a 403 module_forbidden.
    expect(res.status).not.toBe(403);
  });

  it("agent + visible_modules=['desk'] => 403 module_forbidden", async () => {
    const { runOverview } = await loadOverviewHandler({
      role: "agent",
      visible_modules: ["desk"],
    });
    const res = await runOverview();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "module_forbidden", module: "dashboard" });
  });
});

// ── Test helpers ─────────────────────────────────────────────────────────

/**
 * Mocks both supabase clients (server admin + user session) so the route
 * handler can run in isolation. Returns a `runOverview()` closure that
 * invokes the real GET handler.
 *
 * `membership` is the row that supabase.from('memberships') will return
 * for the current user / org pair.
 */
async function loadOverviewHandler(membership: {
  role: string;
  visible_modules: string[] | null;
}) {
  const { vi } = await import("vitest");
  vi.resetModules();

  // Mock supabase admin: stub every from() call to return arrays/zero
  // counts. Good enough to keep the happy path going past requireModule.
  vi.doMock("@/lib/supabase", () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lt: () => builder,
      lte: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => Promise.resolve({ data: [], error: null, count: 0 }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: [], error: null, count: 0 }),
    };
    const admin = {
      from: () => builder,
    };
    return {
      hasSupabase: () => true,
      supabaseServer: () => admin,
    };
  });

  // Mock supabase session: this is what requireModule and requestOrgId
  // consult. We return a user + memberships row according to the test
  // scenario.
  vi.doMock("@/lib/supabase-auth", () => {
    const sessionClient = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
      from(table: string) {
        const rows =
          table === "memberships"
            ? [
                {
                  org_id: "org-1",
                  user_id: "user-1",
                  role: membership.role,
                  visible_modules: membership.visible_modules,
                },
              ]
            : [];
        const builder: Record<string, unknown> = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: () =>
            Promise.resolve({ data: rows[0] ?? null, error: null }),
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: rows, error: null }),
        };
        return builder;
      },
    };
    return {
      ORG_COOKIE: "axon.org_id",
      supabaseSession: () => Promise.resolve(sessionClient),
      currentOrgIdForServer: () => Promise.resolve("org-1"),
      currentUser: () => Promise.resolve({ id: "user-1" }),
      currentMembership: () =>
        Promise.resolve({ org_id: "org-1", role: membership.role }),
      currentRoleInOrg: () => Promise.resolve(membership.role),
      currentUserOrgs: () => Promise.resolve([]),
      currentOrgFromCookie: () => Promise.resolve(null),
      landingPathFor: () => "/dashboard",
    };
  });

  // next/headers cookies(): stub with empty store.
  vi.doMock("next/headers", () => ({
    cookies: async () => ({
      get: () => undefined,
      getAll: () => [],
    }),
  }));

  const mod = await import("@/app/api/dashboard/overview/route");
  return {
    runOverview: async () => {
      const req = new Request("http://localhost/api/dashboard/overview");
      return await (mod.GET as (req: Request) => Promise<Response>)(req);
    },
  };
}
