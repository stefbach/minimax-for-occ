import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET    /api/contact-lists/[id]    → list metadata
 * PATCH  /api/contact-lists/[id]    → rename / edit description / replace columns
 * DELETE /api/contact-lists/[id]    → drop list (contacts.list_id falls back to NULL)
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
      return { error: `invalid column key: ${JSON.stringify(c.key)}` };
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("contact_lists")
    .select("id, name, description, columns, created_at, updated_at")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const body = (await req.json()) as {
    name?: string;
    description?: string | null;
    columns?: unknown;
  };
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    if (name.length > 80) return NextResponse.json({ error: "name max 80 chars" }, { status: 400 });
    patch.name = name;
  }
  if (body.description !== undefined) patch.description = body.description;
  if (body.columns !== undefined) {
    const checked = validateColumns(body.columns);
    if ("error" in checked) {
      return NextResponse.json({ error: checked.error }, { status: 400 });
    }
    patch.columns = checked;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("contact_lists")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId)
    .select("id, name, description, columns, created_at, updated_at")
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "name already used" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { error } = await sb
    .from("contact_lists")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
