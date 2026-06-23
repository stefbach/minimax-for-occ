import HomeLanding from "@/components/home/HomeLanding";
import { currentMembership, landingPathFor } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

/**
 * Public 3D homepage ("/"). No auth required — the middleware whitelists the
 * exact root path. If a session exists we surface a direct "Mon espace" CTA
 * pointing at the role's landing page instead of the login button.
 */
export default async function Home() {
  let spaceHref: string | null = null;
  try {
    const m = await currentMembership();
    if (m) spaceHref = landingPathFor(m.role);
  } catch {
    // Supabase env missing (early bootstrap) — treat as logged out.
    spaceHref = null;
  }
  return <HomeLanding spaceHref={spaceHref} />;
}
