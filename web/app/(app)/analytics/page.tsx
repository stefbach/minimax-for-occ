import { headers } from "next/headers";
import { AnalyticsClient } from "@/components/analytics/AnalyticsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Overview = Parameters<typeof AnalyticsClient>[0]["initial"];

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function originFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) return "";
  return `${proto}://${host}`;
}

async function fetchOverview(range: { from: string; to: string }): Promise<Overview> {
  const origin = await originFromHeaders();
  const url = `${origin}/api/analytics/overview?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as Overview;
  } catch {
    // SSR fallback — empty payload so the page still renders.
    return {
      totals: {
        calls: 0,
        answered: 0,
        abandoned: 0,
        transferred: 0,
        voicemail: 0,
        avg_duration_secs: 0,
      },
      by_day: [],
      by_hour: Array.from({ length: 24 }, (_, hour) => ({ hour, calls: 0 })),
      by_agent: [],
      by_queue: [],
      by_campaign: [],
      by_disposition: [],
      range,
    };
  }
}

export default async function AnalyticsPage() {
  const range = defaultRange();
  const initial = await fetchOverview(range);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <div className="subtitle">
            Volumes, performance agents, files d&apos;attente et campagnes.
          </div>
        </div>
      </div>
      <AnalyticsClient initial={initial} initialRange={range} />
    </div>
  );
}
