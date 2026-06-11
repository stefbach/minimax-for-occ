import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { verifyOrgCookieEdge } from "@/lib/org-cookie-edge";
import {
  hasModule,
  isModuleId,
  pathToModule,
  type ModuleId,
} from "@/lib/permissions";

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

/** Must match `ORG_COOKIE` from web/lib/supabase-auth.ts. Duplicated here to
 *  avoid pulling next/headers into the Edge middleware bundle. */
const ORG_COOKIE = "axon.org_id";

function landingFor(role: Role | null): string {
  switch (role) {
    case "super_admin":
    case "admin":
      return "/admin";
    case "owner":
    case "manager":
    case "analyst":
    case "viewer":
      return "/dashboard";
    case "supervisor":
      // Was /calls — that page was retired June 10 and removed from
      // nav, so a supervisor hitting a denied route was being bounced
      // to a 404. Match landingPathFor() in lib/supabase-auth.ts.
      return "/desk/supervise";
    case "builder":
      return "/agents";
    case "agent":
    default:
      return "/desk";
  }
}

// In-memory cache for (role, visible_modules) lookups. Edge runtime keeps
// module scope per isolate, so this trims the per-request DB round-trip to
// at most one hit every TTL_MS for a given user/org pair. Cache is best-effort
// only — losing it on cold start is fine.
type CacheEntry = { role: Role | null; modules: ModuleId[] | null; expiresAt: number };
const TTL_MS = 60_000;
const CACHE = new Map<string, CacheEntry>();

function readCache(key: string): CacheEntry | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    CACHE.delete(key);
    return null;
  }
  return hit;
}

function writeCache(key: string, role: Role | null, modules: ModuleId[] | null) {
  // Keep the map from growing unbounded under load. 500 entries is plenty
  // for a multi-tenant deploy and stays well under the Edge isolate budget.
  if (CACHE.size > 500) CACHE.clear();
  CACHE.set(key, { role, modules, expiresAt: Date.now() + TTL_MS });
}

/**
 * Refresh the Supabase auth cookie on every request, gate /app routes behind
 * a valid session, and enforce per-module access on sensitive paths (with
 * per-user `visible_modules` overrides taking precedence over role defaults).
 * The `(app)` route group is therefore protected; /login, /signup, /api/*,
 * static assets stay public.
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return res; // dev without Supabase — let everything through

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(toSet) {
        for (const c of toSet) res.cookies.set(c.name, c.value, c.options);
      },
    },
  });

  await supabase.auth.getUser(); // refresh cookies if needed

  const path = req.nextUrl.pathname;
  const publicPaths = ["/login", "/signup", "/auth", "/api", "/_next", "/favicon"];
  if (publicPaths.some((p) => path.startsWith(p))) {
    return res;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  // Resolve the active org for this request:
  //   1. If the user set the `axon.org_id` cookie (via the OrgSwitcher or
  //      super_admin impersonate), verify its HMAC signature + freshness and
  //      use the role inside *that* org.
  //   2. Otherwise fall back to the oldest membership (legacy behavior).
  const rawOrgCookie = req.cookies.get(ORG_COOKIE)?.value || null;
  const wantedOrg = await verifyOrgCookieEdge(rawOrgCookie);

  const cacheKey = `${user.id}::${wantedOrg ?? "primary"}`;
  let role: Role | null = null;
  let visibleModules: ModuleId[] | null = null;

  const cached = readCache(cacheKey);
  if (cached) {
    role = cached.role;
    visibleModules = cached.modules;
  } else {
    if (wantedOrg) {
      const { data: membership } = await supabase
        .from("memberships")
        .select("role, visible_modules")
        .eq("org_id", wantedOrg)
        .eq("user_id", user.id)
        .maybeSingle();
      const row = membership as { role?: string; visible_modules?: unknown } | null;
      role = (row?.role as Role | undefined) ?? null;
      visibleModules = Array.isArray(row?.visible_modules)
        ? ((row!.visible_modules as unknown[]).filter(isModuleId) as ModuleId[])
        : null;
    }

    if (!role) {
      const { data: fallback } = await supabase
        .from("memberships")
        .select("role, visible_modules")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const row = fallback as { role?: string; visible_modules?: unknown } | null;
      role = (row?.role as Role | undefined) ?? null;
      visibleModules = Array.isArray(row?.visible_modules)
        ? ((row!.visible_modules as unknown[]).filter(isModuleId) as ModuleId[])
        : null;
    }

    writeCache(cacheKey, role, visibleModules);
  }

  // super_admin keeps full platform access; module gating doesn't apply.
  if (role === "super_admin") {
    return res;
  }

  // /admin is platform-only. Anyone other than super_admin gets bounced.
  if (path === "/admin" || path.startsWith("/admin/")) {
    const back = req.nextUrl.clone();
    back.pathname = landingFor(role);
    back.search = "";
    return NextResponse.redirect(back);
  }

  const module = pathToModule(path);
  if (module && role) {
    if (!hasModule({ role, visible_modules: visibleModules }, module)) {
      const back = req.nextUrl.clone();
      back.pathname = landingFor(role);
      back.search = "";
      return NextResponse.redirect(back);
    }
  } else if (module && !role) {
    // No membership at all — bounce to login.
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes — auth handled there individually)
     * - _next/static, _next/image (Next internals)
     * - favicon.ico, .well-known
     */
    "/((?!api|_next/static|_next/image|favicon.ico|\\.well-known).*)",
  ],
};
