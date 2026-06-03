import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestContext } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Super-admin only.
 *
 * GET  /api/admin/data-tables?org_id=…
 *   → { assigned: [...], available: [{physical_table}] }
 *     assigned = tables already attributed to that org; available = real
 *     public tables not yet assigned/registered anywhere.
 *
 * POST /api/admin/data-tables   body: { org_id, physical_table, note? }
 *   → assign a physical table to an org.
 *
 * DELETE /api/admin/data-tables?id=…   → remove an assignment.
 */

async function gate(req: Request) {
  const ctx = await requestContext(req);
  if (!ctx.is_super_admin) {
    return { ok: false as const, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, userId: ctx.user_id };
}

export async function GET(req: Request) {
  const g = await gate(req);
  if (!g.ok) return g.response;
  const url = new URL(req.url);
  const orgId = url.searchParams.get("org_id");
  if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });

  const sb = supabaseServer();
  const [{ data: assigned }, { data: available }] = await Promise.all([
    sb
      .from("assignable_data_tables")
      .select("id, physical_table, note, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false }),
    sb.rpc("rpc_list_unassigned_tables"),
  ]);

  return NextResponse.json({
    assigned: assigned ?? [],
    available: (available ?? []) as Array<{ physical_table: string }>,
  });
}

export async function POST(req: Request) {
  const g = await gate(req);
  if (!g.ok) return g.response;
  const body = (await req.json()) as { org_id?: string; physical_table?: string; note?: string };
  if (!body.org_id || !body.physical_table) {
    return NextResponse.json({ error: "org_id and physical_table required" }, { status: 400 });
  }
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("assignable_data_tables")
    .insert({
      org_id: body.org_id,
      physical_table: body.physical_table.trim().toLowerCase(),
      note: body.note ?? null,
      assigned_by: g.userId,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Déjà assignée à cette org." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const g = await gate(req);
  if (!g.ok) return g.response;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("assignable_data_tables").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
