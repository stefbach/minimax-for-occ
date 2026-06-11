import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERVISOR_ROLES = new Set([
  "super_admin",
  "owner",
  "admin",
  "manager",
  "supervisor",
]);

/**
 * POST /api/desk/release   { call_id: string }
 *
 * Drops calls.metadata.assigned_to so the row drifts back to the
 * shared pool. Only supervisors / managers / admins / owners /
 * super_admins may release a call. Agents cannot self-unassign — Wati
 * 2026-06-11: forces the supervisor to acknowledge the handoff.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => null)) as { call_id?: string } | null;
  const callId = (body?.call_id ?? "").trim();
  if (!callId) {
    return NextResponse.json({ error: "call_id required" }, { status: 400 });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  const { data: row, error } = await admin
    .from("calls")
    .select("id, metadata")
    .eq("id", callId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const role = await currentRoleInOrg(orgId);
  const isSupervisor = role ? SUPERVISOR_ROLES.has(role) : false;
  if (!isSupervisor) {
    return NextResponse.json(
      { error: "forbidden — only a supervisor (or above) may release a call" },
      { status: 403 },
    );
  }

  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const assigned = typeof md.assigned_to === "string" ? (md.assigned_to as string) : null;
  if (!assigned) return NextResponse.json({ ok: true, call_id: callId });

  // Strip both assigned_to and claimed_at so the audit reflects the release.
  const { assigned_to: _a, claimed_at: _c, ...rest } = md as Record<string, unknown> & {
    assigned_to?: unknown;
    claimed_at?: unknown;
  };
  void _a;
  void _c;
  const { error: upErr } = await admin
    .from("calls")
    .update({ metadata: { ...rest, released_at: new Date().toISOString() } })
    .eq("id", callId)
    .eq("org_id", orgId);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, call_id: callId });
}
