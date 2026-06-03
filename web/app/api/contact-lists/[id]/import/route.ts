import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ROWS = 10000;

/**
 * POST /api/contact-lists/[id]/import
 *
 * Multipart/form-data upload of a CSV or XLSX file into a specific
 * "Base de Contacts". Each row becomes a contact in that list.
 *
 * Column mapping rules:
 *   - The standard contact columns (phone, name/display_name, email)
 *     are detected by header name (case-insensitive, with FR aliases).
 *   - Every column declared in the list's `columns` spec is also
 *     detected by either its `key` or its `label`. Matched values go
 *     into `contacts.attributes` jsonb under the column's `key`.
 *   - Unknown columns are silently ignored (we don't want a typo in the
 *     header row to lose the whole import).
 *
 * Returns { inserted, skipped, errors[] } so the UI can display a
 * per-row error list when the spreadsheet has bad data.
 */

interface ColumnSpec {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean" | "phone" | "email" | "json";
}

const PHONE_HEADERS = ["phone", "tel", "telephone", "téléphone", "numero", "numero_telephone", "e164"];
const NAME_HEADERS = ["name", "nom", "display_name", "fullname", "full_name"];
const EMAIL_HEADERS = ["email", "mail", "e-mail"];

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[\s._-]+/g, "_");
}

function findHeader(row: Record<string, unknown>, candidates: string[]): string {
  const normalized = new Map(Object.keys(row).map((h) => [norm(h), h]));
  for (const c of candidates) {
    const real = normalized.get(norm(c));
    if (real !== undefined) return real;
  }
  return "";
}

function toE164(raw: string): string | null {
  const s = raw.replace(/[\s().-]/g, "");
  if (/^\+\d{6,15}$/.test(s)) return s;
  if (/^\d{6,15}$/.test(s)) return `+${s}`;
  return null;
}

function coerce(value: unknown, type: ColumnSpec["type"]): unknown {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "") return null;
  switch (type) {
    case "number": {
      const n = Number(s.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      const low = s.toLowerCase();
      if (["true", "1", "yes", "y", "oui", "o"].includes(low)) return true;
      if (["false", "0", "no", "n", "non"].includes(low)) return false;
      return null;
    }
    case "date":
      // Accept anything Date can parse, return ISO date (YYYY-MM-DD).
      try {
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return s; // keep raw if unparseable
        return d.toISOString().slice(0, 10);
      } catch {
        return s;
      }
    case "json":
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    default:
      return s;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const { id: listId } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();

  // 1. Make sure the list exists in the caller's org + grab its column spec.
  const { data: list, error: listErr } = await sb
    .from("contact_lists")
    .select("id, name, columns")
    .eq("id", listId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
  if (!list) return NextResponse.json({ error: "list not found" }, { status: 404 });
  const columns: ColumnSpec[] = Array.isArray(list.columns) ? list.columns : [];

  // 2. Parse the upload.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data with a 'file' field" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size === 0 || file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "file too small/large (max 20 MB)" }, { status: 400 });
  }

  const buf = await file.arrayBuffer();
  let rows: Record<string, unknown>[];
  try {
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) {
      return NextResponse.json({ error: "no sheets" }, { status: 400 });
    }
    rows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { defval: "" });
  } catch (err) {
    return NextResponse.json(
      { error: `parse error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, skipped: 0, errors: [] });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `too many rows (${rows.length} > ${MAX_ROWS})` },
      { status: 400 },
    );
  }

  // 3. Resolve header → column-key mapping ONCE using the first row's keys
  //    (sheet_to_json keeps headers consistent across rows).
  const sample = rows[0];
  const phoneHeader = findHeader(sample, PHONE_HEADERS);
  const nameHeader = findHeader(sample, NAME_HEADERS);
  const emailHeader = findHeader(sample, EMAIL_HEADERS);
  const customMap = new Map<string, ColumnSpec>(); // realHeader → spec
  for (const col of columns) {
    const real = findHeader(sample, [col.key, col.label]);
    if (real) customMap.set(real, col);
  }

  // 4. Build the insert payload row-by-row, validating phones.
  const payload: Array<{
    org_id: string;
    list_id: string;
    e164: string;
    display_name: string | null;
    email: string | null;
    attributes: Record<string, unknown>;
  }> = [];
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2; // header = row 1
    const phone = phoneHeader ? String(r[phoneHeader] ?? "").trim() : "";
    if (!phone) {
      errors.push({ row: rowNum, reason: "phone missing" });
      continue;
    }
    const e164 = toE164(phone);
    if (!e164) {
      errors.push({ row: rowNum, reason: `invalid phone: ${phone}` });
      continue;
    }
    const attributes: Record<string, unknown> = {};
    for (const [header, spec] of customMap.entries()) {
      const v = coerce(r[header], spec.type);
      if (v !== null) attributes[spec.key] = v;
    }
    payload.push({
      org_id: orgId,
      list_id: listId,
      e164,
      display_name: nameHeader ? String(r[nameHeader] ?? "").trim() || null : null,
      email: emailHeader ? String(r[emailHeader] ?? "").trim() || null : null,
      attributes,
    });
  }

  // 5. Upsert in batches. Conflict on (org_id, e164) — a contact phone
  //    is unique per tenant; re-importing the same number updates the
  //    row (including list_id and attributes).
  let inserted = 0;
  const batchSize = 500;
  for (let i = 0; i < payload.length; i += batchSize) {
    const batch = payload.slice(i, i + batchSize);
    const { error } = await sb
      .from("contacts")
      .upsert(batch, { onConflict: "org_id,e164" });
    if (error) {
      errors.push({
        row: 0,
        reason: `batch ${i / batchSize + 1}: ${error.message}`,
      });
    } else {
      inserted += batch.length;
    }
  }

  return NextResponse.json({
    inserted,
    skipped: errors.filter((e) => e.row > 0).length,
    errors,
    list_id: listId,
    list_name: list.name,
  });
}
