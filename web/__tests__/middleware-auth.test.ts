import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The middleware reads cookies + memberships to decide which org role to
 * enforce on a request. We mock @supabase/ssr to control auth state and
 * the memberships table response per-test.
 *
 * Behaviors covered:
 *   1. No org cookie  -> fall back to oldest membership row.
 *   2. Valid cookie   -> role from the matching membership wins.
 *   3. Cookie targets an org where the user isn't a member -> ignored,
 *      fall back to oldest membership.
 *   4. Malformed / empty cookie value -> ignored.
 */

type Membership = { org_id?: string; user_id?: string; role: string };

// State the mocks read from; rewritten per test.
const state: {
  user: { id: string } | null;
  // When .eq('org_id', X).eq('user_id', Y) is called, return that row if found.
  perOrgMemberships: Array<{ org_id: string; user_id: string; role: string }>;
  // Oldest membership (used by the no-eq fallback query).
  oldestMembership: Membership | null;
} = {
  user: { id: "user-1" },
  perOrgMemberships: [],
  oldestMembership: null,
};

function buildMembershipsQuery() {
  const filters: Record<string, unknown> = {};
  const api: Record<string, unknown> = {
    select(_cols: string) {
      return api;
    },
    eq(col: string, val: unknown) {
      filters[col] = val;
      return api;
    },
    order(_col: string, _opts: unknown) {
      return api;
    },
    limit(_n: number) {
      return api;
    },
    maybeSingle() {
      // Cookie-targeted query has both org_id and user_id filters.
      if (filters.org_id && filters.user_id) {
        const match = state.perOrgMemberships.find(
          (m) => m.org_id === filters.org_id && m.user_id === filters.user_id,
        );
        return Promise.resolve({ data: match ?? null, error: null });
      }
      // Fallback "oldest membership" query.
      return Promise.resolve({ data: state.oldestMembership, error: null });
    },
  };
  return api;
}

// verifyOrgCookieEdge checks HMAC signatures — bypass in tests by returning the raw value.
vi.mock("@/lib/org-cookie-edge", () => ({
  verifyOrgCookieEdge: (raw: string | null) => Promise.resolve(raw || null),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: state.user }, error: null }),
    },
    from: (table: string) => {
      if (table === "memberships") return buildMembershipsQuery();
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

// Capture redirect targets so we can assert against them.
const redirects: string[] = [];

vi.mock("next/server", () => ({
  NextResponse: {
    next: (_opts: unknown) => ({ cookies: { set: () => {} }, type: "next" }),
    redirect: (url: URL) => {
      redirects.push(url.pathname);
      return { type: "redirect", url };
    },
  },
}));

// Lightweight NextRequest fake.
function makeRequest(opts: {
  path: string;
  cookies?: Record<string, string>;
}) {
  const cookieMap = new Map(Object.entries(opts.cookies ?? {}));
  return {
    nextUrl: {
      pathname: opts.path,
      searchParams: new URLSearchParams(),
      clone() {
        const cloned = { ...(this as object) } as unknown as {
          pathname: string;
          search: string;
          searchParams: URLSearchParams;
        };
        cloned.searchParams = new URLSearchParams();
        cloned.search = "";
        return cloned;
      },
    },
    cookies: {
      get(name: string) {
        return cookieMap.has(name) ? { value: cookieMap.get(name)! } : undefined;
      },
      getAll() {
        return Array.from(cookieMap.entries()).map(([name, value]) => ({ name, value }));
      },
    },
  } as never;
}

describe("middleware auth + role resolution", () => {
  beforeEach(() => {
    // Reset state and capture buckets before each test.
    state.user = { id: "user-1" };
    state.perOrgMemberships = [];
    state.oldestMembership = null;
    redirects.length = 0;
    // Provide Supabase env so middleware doesn't early-exit as "dev mode".
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  it("falls back to the oldest membership when no org cookie is set", async () => {
    const { middleware } = await import("@/middleware");
    state.oldestMembership = { role: "manager" };

    // /dashboard is allowed for managers, so no redirect should happen.
    await middleware(makeRequest({ path: "/dashboard" }) as never);
    expect(redirects).toEqual([]);

    // /admin is admin-only — a manager should be redirected back to /dashboard.
    await middleware(makeRequest({ path: "/admin" }) as never);
    expect(redirects).toContain("/dashboard");
  });

  it("uses the role from the org pointed to by axon.org_id when valid", async () => {
    const { middleware } = await import("@/middleware");
    // /admin is platform-only (super_admin). Use super_admin here so the probe
    // path actually exercises "the cookie-targeted org's role wins over the
    // oldest membership": super_admin (org-A) is allowed through, whereas the
    // agent fallback would be bounced.
    state.perOrgMemberships = [{ org_id: "org-A", user_id: "user-1", role: "super_admin" }];
    state.oldestMembership = { role: "agent" };

    // Cookie says org-A where user is super_admin → /admin should be allowed.
    await middleware(
      makeRequest({ path: "/admin", cookies: { "axon.org_id": "org-A" } }) as never,
    );
    expect(redirects).toEqual([]);
  });

  it("ignores the cookie when the user isn't a member of the target org", async () => {
    const { middleware } = await import("@/middleware");
    // No entry in perOrgMemberships for org-B → cookie lookup returns null.
    // Falls back to the oldest membership (agent), which can't see /admin.
    state.oldestMembership = { role: "agent" };

    await middleware(
      makeRequest({ path: "/admin", cookies: { "axon.org_id": "org-B" } }) as never,
    );
    // agent's landing is /desk
    expect(redirects).toContain("/desk");
  });

  it("ignores an empty / malformed cookie value", async () => {
    const { middleware } = await import("@/middleware");
    state.oldestMembership = { role: "supervisor" };

    // Empty cookie → wantedOrg is falsy → straight to fallback (supervisor).
    await middleware(
      makeRequest({ path: "/calls", cookies: { "axon.org_id": "" } }) as never,
    );
    // /calls is allowed for supervisor → no redirect.
    expect(redirects).toEqual([]);
  });

  it("redirects unauthenticated users to /login", async () => {
    const { middleware } = await import("@/middleware");
    state.user = null;

    await middleware(makeRequest({ path: "/dashboard" }) as never);
    expect(redirects).toContain("/login");
  });
});
