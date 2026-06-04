import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { requireModule } from "@/lib/permissions-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const orgId = await requestOrgId(req);
  const gate = await requireModule(orgId, "contacts");
  if (!gate.allowed) {
    return NextResponse.json({ error: "module_forbidden", module: "contacts" }, { status: 403 });
  }
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("contacts")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  if (!hasSupabase()) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const orgId = await requestOrgId(req);
  const body = (await req.json()) as {
    e164: string;
    display_name?: string;
    email?: string;
    tags?: string[];
    notes?: string;
  };
  if (!body.e164) return NextResponse.json({ error: "e164 required" }, { status: 400 });
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("contacts")
    .upsert(
      {
        org_id: orgId,
        e164: body.e164,
        display_name: body.display_name ?? null,
        email: body.email ?? null,
        tags: body.tags ?? [],
        notes: body.notes ?? null,
      },
      { onConflict: "org_id,e164" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("contacts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
