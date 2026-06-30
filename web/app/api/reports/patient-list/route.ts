import { NextResponse } from "next/server";
import { currentOrgIdForServer, currentRoleInOrg } from "@/lib/supabase-auth";
import { loadPatientDataForExport } from "@/lib/reports/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["super_admin", "owner", "admin", "manager"]);

export async function GET(req: Request) {
  const orgId = await currentOrgIdForServer();
  if (!orgId) return NextResponse.json({ error: "no org" }, { status: 401 });
  const role = await currentRoleInOrg(orgId);
  if (!role || !ALLOWED_ROLES.has(role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = url.searchParams.get("to") ?? new Date().toISOString();

  const patients = await loadPatientDataForExport(orgId, { fromIso: from, toIso: to });
  return NextResponse.json({ patients });
}
