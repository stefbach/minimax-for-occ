import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ROWS = 5000;

/**
 * POST /api/contacts/import   (multipart/form-data, field: file)
 *
 * Reads an .xlsx file (the template downloaded from
 * /api/contacts/template, or any sheet with the same columns) and
 * bulk-upserts each row as a contact under the caller's active org.
 *
 * Expected columns (case-insensitive header match, only `phone` is
 * required):
 *   phone   E.164 or local number — anything starting with + or that
 *           sanitises to digits we'll prefix with + and accept.
 *   name    display_name
 *   email
 *   tags    comma-separated string, parsed into the tags array
 *   notes
 *
 * Returns { inserted, skipped, errors } so the UI can display a
 * per-row error list when the user's spreadsheet has bad data.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const orgId = await requestOrgId(req);

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
  if (file.size === 0 || file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "file too small/large (max 10 MB)" },
      { status: 400 },
    );
  }

  // Parse the workbook. XLSX reads the first sheet by default.
  const arrayBuffer = await file.arrayBuffer();
  let rows: Record<string, unknown>[];
  try {
    const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) {
      return NextResponse.json({ error: "workbook has no sheets" }, { status: 400 });
    }
    const ws = wb.Sheets[firstSheetName];
    rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unparseable xlsx";
    return NextResponse.json({ error: `Excel: ${msg}` }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, skipped: 0, errors: [] });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `trop de lignes (${rows.length} > ${MAX_ROWS}). Découpe le fichier.` },
      { status: 400 },
    );
  }

  const sb = supabaseServer();
  const errors: { row: number; reason: string }[] = [];
  const upsertPayload: Array<{
    org_id: string;
    e164: string;
    display_name: string | null;
    email: string | null;
    tags: string[];
    notes: string | null;
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2; // header is row 1, so data starts at 2

    // Case-insensitive lookup of each expected field.
    const phone = stringField(r, ["phone", "Phone", "PHONE", "tel", "téléphone", "telephone"]);
    const name = stringField(r, ["name", "Name", "nom", "Nom", "display_name"]);
    const email = stringField(r, ["email", "Email", "mail"]);
    const tagsRaw = stringField(r, ["tags", "Tags", "etiquettes"]);
    const notes = stringField(r, ["notes", "Notes"]);

    if (!phone) {
      errors.push({ row: rowNum, reason: "phone manquant" });
      continue;
    }
    const e164 = toE164(phone);
    if (!e164) {
      errors.push({ row: rowNum, reason: `phone invalide: "${phone}" (attendu E.164 ex: +33612345678)` });
      continue;
    }

    upsertPayload.push({
      org_id: orgId,
      e164,
      display_name: name || null,
      email: email || null,
      tags: tagsRaw
        ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
        : [],
      notes: notes || null,
    });
  }

  let inserted = 0;
  if (upsertPayload.length > 0) {
    // Upsert in batches of 500 to stay well under Postgres / network limits.
    const batchSize = 500;
    for (let i = 0; i < upsertPayload.length; i += batchSize) {
      const batch = upsertPayload.slice(i, i + batchSize);
      const { error } = await sb
        .from("contacts")
        .upsert(batch, { onConflict: "org_id,e164" });
      if (error) {
        errors.push({
          row: 0,
          reason: `Insertion batch ${i / batchSize + 1} échouée: ${error.message}`,
        });
      } else {
        inserted += batch.length;
      }
    }
  }

  return NextResponse.json({
    inserted,
    skipped: errors.filter((e) => e.row > 0).length,
    errors,
  });
}

function stringField(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") {
      return String(v).trim();
    }
  }
  return "";
}

/**
 * Normalise a phone string to E.164. Accepts +33 6 12 34 56 78,
 * 33612345678, +33612345678 etc. Rejects anything that doesn't
 * sanitise to 6-15 digits.
 */
function toE164(raw: string): string | null {
  const s = raw.replace(/[\s().-]/g, "");
  if (/^\+\d{6,15}$/.test(s)) return s;
  // Already digits without + — assume they forgot the leading +.
  if (/^\d{6,15}$/.test(s)) return `+${s}`;
  return null;
}
