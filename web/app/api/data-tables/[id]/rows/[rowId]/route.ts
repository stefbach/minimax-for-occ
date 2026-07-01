import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH  /api/data-tables/[id]/rows/[rowId]  → update one contact row
 *        body: { values: { <column>: <value>, ... } }
 * DELETE /api/data-tables/[id]/rows/[rowId]  → delete one contact row
 *
 * Same tenant-isolation pattern as the parent route: the registry id is
 * verified against org_id before touching the physical table.
 */

async function resolveTable(
  sb: ReturnType<typeof supabaseServer>,
  registryId: string,
  orgId: string,
) {
  const { data } = await sb
    .from("tenant_data_tables")
    .select("id, physical_table, columns, phone_column")
    .eq("id", registryId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; rowId: string }> },
) {
  const { id, rowId } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const reg = await resolveTable(sb, id, orgId);
  if (!reg) return NextResponse.json({ error: "table not found" }, { status: 404 });

  const body = (await req.json()) as { values?: Record<string, unknown> };
  const values = body.values ?? {};

  const allowed = new Set<string>([
    reg.phone_column,
    ...((reg.columns as Array<{ key: string }>) ?? []).map((c) => c.key),
  ]);
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!allowed.has(k)) continue;
    // Empty string → null (lets the user clear a field).
    clean[k] = v === "" ? null : v;
  }
  if (Object.keys(clean).length === 0) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }
  if (reg.phone_column in clean && !clean[reg.phone_column]) {
    return NextResponse.json(
      { error: `Phone number (${reg.phone_column}) cannot be empty.` },
      { status: 400 },
    );
  }

  const { data, error } = await sb
    .from(reg.physical_table)
    .update(clean)
    .eq("id", rowId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; rowId: string }> },
) {
  const { id, rowId } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const reg = await resolveTable(sb, id, orgId);
  if (!reg) return NextResponse.json({ error: "table not found" }, { status: 404 });

  const { error } = await sb.from(reg.physical_table).delete().eq("id", rowId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
