import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/data-tables/[id]/rows        → rows of the registered physical table
 * POST /api/data-tables/[id]/rows        → insert one row (a "contact")
 *      body: { values: { <column>: <value>, ... } }
 *
 * The [id] is the tenant_data_tables registry id. We resolve it to the
 * physical table name AFTER verifying the registry row belongs to the
 * caller's org — so a caller can never read/write a table that isn't theirs.
 */

async function resolveTable(
  sb: ReturnType<typeof supabaseServer>,
  registryId: string,
  orgId: string,
) {
  const { data } = await sb
    .from("tenant_data_tables")
    .select("id, physical_table, columns, phone_column, name_column")
    .eq("id", registryId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const reg = await resolveTable(sb, id, orgId);
  if (!reg) return NextResponse.json({ error: "table not found" }, { status: 404 });

  // Tables aligned with OCC prod don't have `created_at` — they use
  // `date_creation` instead. Detect the timestamp column dynamically so the
  // GET endpoint works regardless of the tenant's schema convention.
  let orderCol: string | null = null;
  try {
    const { data: colInfo } = await sb
      .from("information_schema.columns" as never)
      .select("column_name")
      .eq("table_name", reg.physical_table);
    const colNames = new Set(
      (colInfo ?? []).map((c) => (c as { column_name: string }).column_name),
    );
    orderCol = ["created_at", "date_creation", "inserted_at", "updated_at"].find(
      (c) => colNames.has(c),
    ) ?? null;
  } catch { /* fall through, unordered query */ }

  let q = sb.from(reg.physical_table).select("*").limit(1000);
  if (orderCol) q = q.order(orderCol, { ascending: false, nullsFirst: false });
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ table: reg, rows: data ?? [] });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const reg = await resolveTable(sb, id, orgId);
  if (!reg) return NextResponse.json({ error: "table not found" }, { status: 404 });

  const body = (await req.json()) as { values?: Record<string, unknown> };
  const values = body.values ?? {};

  // Only allow declared columns (+ phone). Strip anything else so a caller
  // can't write to system/unknown columns.
  const allowed = new Set<string>([
    reg.phone_column,
    ...((reg.columns as Array<{ key: string }>) ?? []).map((c) => c.key),
  ]);
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (allowed.has(k) && v !== "" && v !== null && v !== undefined) clean[k] = v;
  }
  if (!clean[reg.phone_column]) {
    return NextResponse.json(
      { error: `Le numéro (${reg.phone_column}) est requis.` },
      { status: 400 },
    );
  }

  const { data, error } = await sb.from(reg.physical_table).insert(clean).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
