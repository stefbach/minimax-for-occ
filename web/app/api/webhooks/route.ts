import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Outbound webhooks Axon fires at n8n when the agent writes a watched column
// (e.g. `qualification`) in-call — the hook for post-RDV Email/WhatsApp.

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const sb = supabaseServer();
  const org_id = await requestOrgId(req);
  const { data, error } = await sb
    .from("org_webhooks")
    .select("id,name,url,event,data_table_id,watch_column,match_values,active,created_at")
    .eq("org_id", org_id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }
  const org_id = await requestOrgId(req);
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    url?: string;
    event?: string;
    data_table_id?: string | null;
    watch_column?: string;
    match_values?: string[];
    headers?: Record<string, string>;
    active?: boolean;
  } | null;
  if (!body?.name || !body?.url) {
    return NextResponse.json({ error: "name et url requis" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(body.url)) {
    return NextResponse.json({ error: "url invalide (http/https requis)" }, { status: 400 });
  }
  const sb = supabaseServer();

  // If a data table is scoped, verify it belongs to the caller's org.
  let dataTableId: string | null = null;
  if (body.data_table_id) {
    const { data: dt } = await sb
      .from("tenant_data_tables")
      .select("id")
      .eq("id", body.data_table_id)
      .eq("org_id", org_id)
      .maybeSingle();
    if (dt) dataTableId = dt.id as string;
  }

  const { data, error } = await sb
    .from("org_webhooks")
    .insert({
      org_id,
      name: body.name,
      url: body.url,
      event: body.event || "qualification_changed",
      data_table_id: dataTableId,
      watch_column: body.watch_column || "qualification",
      match_values: Array.isArray(body.match_values) ? body.match_values : [],
      headers: body.headers && typeof body.headers === "object" ? body.headers : {},
      active: body.active ?? true,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  const org_id = await requestOrgId(req);
  const body = (await req.json().catch(() => null)) as
    | ({ id?: string } & Record<string, unknown>)
    | null;
  if (!body?.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const sb = supabaseServer();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["name", "url", "event", "watch_column", "match_values", "active", "headers"]) {
    if (k in body) patch[k] = body[k];
  }
  const { data, error } = await sb
    .from("org_webhooks")
    .update(patch)
    .eq("id", body.id)
    .eq("org_id", org_id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  const org_id = await requestOrgId(req);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("org_webhooks").delete().eq("id", id).eq("org_id", org_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
