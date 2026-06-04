import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { verifyOrgCookieEdge } from "@/lib/org-cookie-edge";

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

/**
 * Path prefix → allowed roles. The longest matching prefix wins. Paths not
 * listed here are allowed for any authenticated user.
 */
// "owner" is the per-org top role (e.g. the founder of a tenant). It must be
// granted the same access as "admin" inside its own org. "builder" can edit
// agent-side configuration. "analyst" and "viewer" are read-only roles.
const MGMT: Role[] = ["super_admin", "admin", "owner", "manager"];
const BUILD: Role[] = ["super_admin", "admin", "owner", "manager", "builder"];
// OPS covers everyone allowed to consult operations data — including
// human-agent callers. The owner can still subtract individual modules per
// user via memberships.visible_modules (cf. Wave B). By default agents see
// /dashboard, /calls, /queues.
const OPS: Role[] = ["super_admin", "admin", "owner", "manager", "supervisor", "analyst", "viewer", "agent"];

const ROUTE_ROLES: Array<[string, Role[]]> = [
  ["/admin",     ["super_admin", "admin"]],
  ["/agents",    BUILD],
  ["/voices",    BUILD],
  ["/flows",     BUILD],
  ["/workflows", BUILD],
  ["/documents", BUILD],
  ["/numbers",   MGMT],
  ["/campaigns", MGMT],
  ["/settings",  MGMT],
  ["/queues",    OPS],
  ["/calls",     OPS],
  ["/dashboard", OPS],
  ["/analytics", OPS],
  // /desk and /contacts: open to everyone (no entry → no filter)
];

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
      return "/calls";
    case "builder":
      return "/agents";
    case "agent":
    default:
      return "/desk";
  }
}

function isAllowed(path: string, role: Role | null): boolean {
  if (!role) return false;
  // longest prefix match
  let match: Role[] | null = null;
  let matchLen = 0;
  for (const [prefix, roles] of ROUTE_ROLES) {
    if (path === prefix || path.startsWith(prefix + "/")) {
      if (prefix.length > matchLen) {
        match = roles;
        matchLen = prefix.length;
      }
    }
  }
  if (!match) return true; // no rule → permissive
  return match.includes(role);
}

/**
 * Refresh the Supabase auth cookie on every request, gate /app routes behind
 * a valid session, and enforce role-based access on sensitive paths. The
 * `(app)` route group is therefore protected; /login, /signup, /api/*, static
 * assets stay public.
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

  let role: Role | null = null;
  if (wantedOrg) {
    const { data: membership } = await supabase
      .from("memberships")
      .select("role")
      .eq("org_id", wantedOrg)
      .eq("user_id", user.id)
      .maybeSingle();
    role = (membership?.role as Role) ?? null;
  }

  if (!role) {
    const { data: fallback } = await supabase
      .from("memberships")
      .select("role")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    role = (fallback?.role as Role) ?? null;
  }

  if (!isAllowed(path, role)) {
    const back = req.nextUrl.clone();
    back.pathname = landingFor(role);
    back.search = "";
    return NextResponse.redirect(back);
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
