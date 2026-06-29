import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Data Tables = real Postgres tables a tenant owns (e.g. OCC's leads_rdv,
 * leads_rdv_test_axon). Each org only ever sees the tables registered to it
 * in tenant_data_tables. Real columns (not a jsonb blob) so external n8n
 * automations can point at the project and find the exact schema.
 *
 * GET  /api/data-tables          → registered tables for the caller's org (+ row counts)
 * POST /api/data-tables          → create a brand-new physical table + register it
 *      body: { physical_table, label, columns:[{key,label,type}], phone_column?, name_column? }
 */

interface ColumnSpec {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "datetime" | "boolean" | "phone" | "email" | "json";
}

const ALLOWED_TYPES = ["text", "number", "date", "datetime", "boolean", "phone", "email", "json"];

function validateColumns(input: unknown): ColumnSpec[] | { error: string } {
  if (!Array.isArray(input)) return { error: "columns must be an array" };
  const seen = new Set<string>();
  const out: ColumnSpec[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { error: "each column must be an object" };
    const c = raw as Record<string, unknown>;
    const key = typeof c.key === "string" ? c.key.trim() : "";
    const label = typeof c.label === "string" ? c.label.trim() : "";
    const type = typeof c.type === "string" ? c.type : "";
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) {
      return { error: `invalid column key "${c.key}" (a-z, 0-9, _, starts with a letter)` };
    }
    if (["id", "created_at", "updated_at"].includes(key)) {
      return { error: `"${key}" is reserved (added automatically)` };
    }
    if (seen.has(key)) return { error: `duplicate column key: ${key}` };
    seen.add(key);
    if (!label) return { error: `column ${key}: label required` };
    if (!ALLOWED_TYPES.includes(type)) return { error: `column ${key}: invalid type ${type}` };
    out.push({ key, label, type: type as ColumnSpec["type"] });
  }
  return out;
}

export async function GET(req: Request) {
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data: tables, error } = await sb
    .from("tenant_data_tables")
    .select("id, physical_table, label, columns, phone_column, name_column, is_managed, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Row count per table (best-effort; a broken physical table shouldn't 500 the list).
  const out = [];
  for (const t of tables ?? []) {
    let count = 0;
    try {
      const { count: c } = await sb
        .from(t.physical_table)
        .select("id", { count: "exact", head: true });
      count = c ?? 0;
    } catch {
      count = 0;
    }
    out.push({ ...t, row_count: count });
  }
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  const orgId = await requestOrgId(req);
  const body = (await req.json()) as {
    physical_table?: string;
    label?: string;
    columns?: unknown;
    phone_column?: string;
    name_column?: string;
  };
  const physical = (body.physical_table ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(physical)) {
    return NextResponse.json(
      { error: "Invalid table name (a-z, 0-9, _, must start with a letter, min 3 characters)" },
      { status: 400 },
    );
  }
  const label = (body.label ?? "").trim() || physical;
  const checked = validateColumns(body.columns ?? []);
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  const phoneCol = (body.phone_column ?? "numero_telephone").trim();
  const nameCol = (body.name_column ?? "nom").trim() || null;

  const sb = supabaseServer();
  const { data, error } = await sb.rpc("rpc_create_data_table", {
    p_org_id: orgId,
    p_physical_table: physical,
    p_label: label,
    p_columns: checked,
    p_phone_column: phoneCol,
    p_name_column: nameCol,
  });
  if (error) {
    const m = error.message.toLowerCase();
    const taken =
      m.includes("already exists") ||
      m.includes("duplicate key") ||
      m.includes("unique constraint") ||
      m.includes("physical_table");
    const msg = taken
      ? `Table name "${physical}" is already taken. Please choose another.`
      : error.message;
    return NextResponse.json(
      { error: msg, code: taken ? "name_taken" : undefined },
      { status: taken ? 409 : 400 },
    );
  }
  return NextResponse.json({ id: data, physical_table: physical, label }, { status: 201 });
}
