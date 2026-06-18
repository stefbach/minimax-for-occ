import { NextResponse } from "next/server";
import { currentOrgIdForServer, currentRoleInOrg } from "@/lib/supabase-auth";
import { buildPilotageHebdo } from "@/lib/reports/build-pilotage-hebdo";
import type { ReportPayload, ReportPeriod, ReportType } from "@/lib/reports/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_ROLES = new Set(["super_admin", "owner", "admin", "manager"]);
const ALLOWED_TYPES: ReportType[] = [
  "pilotage_hebdo",
  "bilan_mensuel",
  // v2: perf_par_agent, funnel_campagne, nhs_s2
];

interface RequestBody {
  type?: ReportType;
  /** ISO from (UTC). Inclusive. */
  from?: string;
  /** ISO to (UTC). Exclusive. */
  to?: string;
  lang?: "fr" | "en";
}

function defaultWeekPeriod(): ReportPeriod {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 7);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: formatPeriodLabel(from, to),
  };
}

function formatPeriodLabel(from: Date, to: Date): string {
  const f = from.toLocaleDateString("fr-FR", { day: "2-digit", month: "long" });
  // `to` is exclusive — display the inclusive end (the previous day).
  const inclusiveEnd = new Date(to.getTime() - 86_400_000);
  const t = inclusiveEnd.toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  });
  return `Du ${f} au ${t}`;
}

export async function POST(req: Request): Promise<NextResponse<ReportPayload | { error: string }>> {
  const orgId = await currentOrgIdForServer();
  if (!orgId) {
    return NextResponse.json({ error: "no org" }, { status: 401 });
  }
  const role = await currentRoleInOrg(orgId);
  if (!role || !ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    /* empty body = defaults */
  }

  const type: ReportType = body.type ?? "pilotage_hebdo";
  if (!ALLOWED_TYPES.includes(type)) {
    return NextResponse.json({ error: `template not available yet: ${type}` }, { status: 400 });
  }

  const lang = body.lang ?? "fr";

  let period: ReportPeriod;
  if (body.from && body.to) {
    const fromDate = new Date(body.from);
    const toDate = new Date(body.to);
    period = {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      label: formatPeriodLabel(fromDate, toDate),
    };
  } else {
    period = defaultWeekPeriod();
  }

  try {
    let payload: ReportPayload;
    switch (type) {
      case "pilotage_hebdo":
        payload = await buildPilotageHebdo({ orgId, period, lang });
        break;
      case "bilan_mensuel":
        payload = await buildPilotageHebdo({ orgId, period, lang, type: "bilan_mensuel" });
        break;
      default:
        return NextResponse.json({ error: "not implemented" }, { status: 501 });
    }
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[reports/generate] failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "build failed" },
      { status: 500 },
    );
  }
}
