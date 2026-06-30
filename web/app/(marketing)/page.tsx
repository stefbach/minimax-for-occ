import HomeLanding from "@/components/home/HomeLanding";
import { currentMembership, landingPathFor } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  let spaceHref: string | null = null;
  try {
    const m = await currentMembership();
    if (m) spaceHref = landingPathFor(m.role);
  } catch {
    spaceHref = null;
  }
  return <HomeLanding spaceHref={spaceHref} />;
}
