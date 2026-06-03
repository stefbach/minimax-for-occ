import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/contact-lists
 * Returns every "Base de contacts" owned by the caller's org, with a
 * fresh contact count for each.
 *
 * POST /api/contact-lists
 * Body: { name, description?, columns?: ColumnSpec[] }
 * Creates a new base. Columns is an ordered array of
 * { key, label, type } describing the per-contact attribute schema.
 */

interface ColumnSpec {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "phone" | "email" | "json";
  required?: boolean;
}

const ALLOWED_TYPES: ColumnSpec["type"][] = [
  "text", "number", "date", "boolean", "phone", "email", "json",
];

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
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
      return { error: `invalid column key: ${JSON.stringify(c.key)} (a-z, 0-9, _, starts with a letter)` };
    }
    if (seen.has(key)) return { error: `duplicate column key: ${key}` };
    seen.add(key);
    if (!label) return { error: `column ${key}: label required` };
    if (!ALLOWED_TYPES.includes(type as ColumnSpec["type"])) {
      return { error: `column ${key}: invalid type ${type}` };
    }
    out.push({ key, label, type: type as ColumnSpec["type"], required: c.required === true });
  }
  return out;
}

export async function GET(req: Request) {
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data: lists, error } = await sb
    .from("contact_lists")
    .select("id, name, description, columns, created_at, updated_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach a contact count per list (single round-trip via grouping).
  const ids = (lists ?? []).map((l) => l.id);
  let counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: rows } = await sb
      .from("contacts")
      .select("list_id")
      .eq("org_id", orgId)
      .in("list_id", ids);
    for (const r of rows ?? []) {
      const k = (r as { list_id: string }).list_id;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }

  return NextResponse.json(
    (lists ?? []).map((l) => ({ ...l, contact_count: counts[l.id] ?? 0 })),
  );
}

export async function POST(req: Request) {
  const orgId = await requestOrgId(req);
  const body = (await req.json()) as {
    name?: string;
    description?: string;
    columns?: unknown;
  };
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (name.length > 80) {
    return NextResponse.json({ error: "name max 80 chars" }, { status: 400 });
  }

  let columns: ColumnSpec[] = [];
  if (body.columns !== undefined && body.columns !== null) {
    const checked = validateColumns(body.columns);
    if ("error" in checked) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }
    columns = checked;
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("contact_lists")
    .insert({
      org_id: orgId,
      name,
      description: body.description ?? null,
      columns,
    })
    .select("id, name, description, columns, created_at, updated_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A list with this name already exists for this organization" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ...data, contact_count: 0 }, { status: 201 });
}
