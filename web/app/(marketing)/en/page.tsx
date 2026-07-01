import { redirect } from "next/navigation";
import AxonHome from "@/components/home/AxonHome";
import { currentMembership, landingPathFor } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export default async function EnglishHome() {
  let m = null;
  try {
    m = await currentMembership();
  } catch {
    // Supabase not configured or session missing — show public homepage
  }
  if (m) redirect(landingPathFor(m.role));
  return <AxonHome lang="en" spaceHref={null} />;
}
