import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin", "manager"]);

/**
 * GET  /api/automations/credentials → list (id, name, kind, masked hints — NEVER secrets)
 * POST /api/automations/credentials → create/replace { name, kind, data }
 *      kinds: 'smtp'          {host, port, user, pass, from}
 *             'wati'          {base_url, token}
 *             'http_bearer'   {token}
 *             'supabase_data' {url, service_key}     — patient pipeline DB
 *             'anthropic'     {api_key, default_model?} — AI brains
 *             'gmail_oauth'   {client_id, client_secret, refresh_token, sender?}
 *             'telegram'      {bot_token, chat_id?}
 *
 * Secrets go in, never come back out: GET only exposes which fields are set.
 */
const ALLOWED_KINDS = [
  "smtp",
  "wati",
  "http_bearer",
  "supabase_data",
  "anthropic",
  "gmail_oauth",
  "telegram",
];
export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ credentials: [] });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = supabaseServer();
  const { data, error } = await admin
    .from("org_credentials")
    .select("id, name, kind, data, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const masked = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    fields_set: Object.entries((c.data as Record<string, unknown>) ?? {})
      .filter(([, v]) => v != null && String(v).length > 0)
      .map(([k]) => k),
    created_at: c.created_at,
  }));
  return NextResponse.json({ credentials: masked });
}

export async function POST(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    kind?: string;
    data?: Record<string, unknown>;
  } | null;
  if (!body?.name || !body.kind || !body.data) {
    return NextResponse.json({ error: "name, kind, data required" }, { status: 400 });
  }
  if (!ALLOWED_KINDS.includes(body.kind)) {
    return NextResponse.json({ error: `kind must be one of ${ALLOWED_KINDS.join("|")}` }, { status: 400 });
  }

  const admin = supabaseServer();
  const { data, error } = await admin
    .from("org_credentials")
    .upsert(
      {
        org_id: orgId,
        name: body.name.trim(),
        kind: body.kind,
        data: body.data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,name" },
    )
    .select("id, name, kind")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
