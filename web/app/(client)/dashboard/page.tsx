import { headers } from "next/headers";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import type { DashboardOverviewResponse } from "@/app/api/dashboard/overview/route";
import { currentOrgIdForServer } from "@/lib/supabase-auth";
import { hasSupabase, supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function loadOrgSlug(): Promise<string | null> {
  if (!hasSupabase()) return null;
  try {
    const orgId = await currentOrgIdForServer();
    const { data } = await supabaseServer()
      .from("organizations")
      .select("slug")
      .eq("id", orgId)
      .maybeSingle();
    return ((data as { slug?: string } | null)?.slug) ?? null;
  } catch {
    return null;
  }
}

async function loadOverview(): Promise<{
  data: DashboardOverviewResponse | null;
  error: string | null;
}> {
  try {
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") || "http";
    if (!host) return { data: null, error: "host header missing" };
    const res = await fetch(`${proto}://${host}/api/dashboard/overview`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      return { data: null, error: j.error || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as DashboardOverviewResponse;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "load error" };
  }
}

export default async function DashboardPage() {
  const [{ data, error }, orgSlug] = await Promise.all([loadOverview(), loadOrgSlug()]);
  return <DashboardClient initial={data} initialError={error} orgSlug={orgSlug} />;
}
