import { redirect } from "next/navigation";
import HomeLanding from "@/components/home/HomeLanding";
import { currentMembership, landingPathFor } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  let m = null;
  try {
    m = await currentMembership();
  } catch {
    // Supabase not configured or session missing — show public homepage
  }
  if (m) redirect(landingPathFor(m.role));
  return <HomeLanding spaceHref={null} />;
}
