import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refresh the Supabase auth cookie on every request and gate /app routes
 * behind a valid session. The `(app)` route group is therefore protected;
 * /login, /signup, /api/*, static assets stay public.
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
