import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin", "manager"]);

/**
 * PATCH  /api/automations/:id   → update name/description/trigger/steps/active
 * DELETE /api/automations/:id   → remove the workflow (runs cascade)
 */
async function guard(req: Request) {
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { orgId };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const { id } = await params;
  const g = await guard(req);
  if ("error" in g) return g.error;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["name", "description", "trigger", "steps", "active"]) {
    if (k in body) patch[k] = body[k];
  }
  const admin = supabaseServer();
  const { data, error } = await admin
    .from("org_workflows")
    .update(patch)
    .eq("id", id)
    .eq("org_id", g.orgId)
    .select("id, name, active")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const { id } = await params;
  const g = await guard(req);
  if ("error" in g) return g.error;
  const admin = supabaseServer();
  const { error } = await admin.from("org_workflows").delete().eq("id", id).eq("org_id", g.orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
