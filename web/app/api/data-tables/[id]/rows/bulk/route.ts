import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/data-tables/[id]/rows/bulk
// Body: { rows: Array<Record<string, unknown>> }
//
// Inserts up to 5000 rows in one call. Each row is filtered to declared
// columns (+ phone). Rows missing the phone column are reported back in the
// response so the user knows what failed — successful rows still get
// inserted (partial success). Multi-tenant safe via the registry org check.

const MAX_ROWS = 5000;

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

function normalisePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Strip spaces, dots, dashes, parentheses — keep the leading + if any.
  const cleaned = s.replace(/[\s.\-()]/g, "");
  if (/^\+\d{6,}$/.test(cleaned)) return cleaned;
  if (/^\d{6,}$/.test(cleaned)) return `+${cleaned}`;
  return null;
}

function coerceValue(value: unknown, type: string): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (type === "number") {
    const n = Number(String(value).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (type === "boolean") {
    const s = String(value).toLowerCase().trim();
    if (["true", "1", "oui", "yes", "y", "vrai"].includes(s)) return true;
    if (["false", "0", "non", "no", "n", "faux"].includes(s)) return false;
    return null;
  }
  if (type === "date" || type === "datetime") {
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return String(value);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const reg = await resolveTable(sb, id, orgId);
  if (!reg) return NextResponse.json({ error: "table not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { rows?: unknown[] };
  const incoming = Array.isArray(body.rows) ? body.rows : [];
  if (incoming.length === 0) {
    return NextResponse.json({ error: "Aucune ligne à importer." }, { status: 400 });
  }
  if (incoming.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Trop de lignes (${incoming.length}). Maximum ${MAX_ROWS} par import.` },
      { status: 400 },
    );
  }

  const columns = (reg.columns as Array<{ key: string; type: string }>) ?? [];
  const typeByKey = new Map(columns.map((c) => [c.key, c.type]));
  const allowed = new Set<string>([reg.phone_column, ...columns.map((c) => c.key)]);

  const cleaned: Record<string, unknown>[] = [];
  const errors: { row: number; reason: string }[] = [];

  incoming.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      errors.push({ row: index + 1, reason: "ligne non-objet" });
      return;
    }
    const r = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    // Phone is required + normalised. Accept either the configured phone
    // column or a 'telephone' / 'phone' / 'numero' fallback (helps with CSVs
    // exported by users who don't know the exact column name).
    const phoneRaw =
      r[reg.phone_column] ?? r.telephone ?? r.phone ?? r.numero ?? r.numero_telephone ?? null;
    const phone = normalisePhone(phoneRaw);
    if (!phone) {
      errors.push({ row: index + 1, reason: "téléphone manquant ou invalide" });
      return;
    }
    out[reg.phone_column] = phone;

    for (const [k, v] of Object.entries(r)) {
      if (k === reg.phone_column) continue;
      if (!allowed.has(k)) continue;
      const t = typeByKey.get(k) ?? "text";
      const coerced = coerceValue(v, t);
      if (coerced !== null) out[k] = coerced;
    }

    cleaned.push(out);
  });

  let inserted = 0;
  if (cleaned.length > 0) {
    // Chunk inserts to keep payload size sane (~500 rows per batch).
    const CHUNK = 500;
    for (let i = 0; i < cleaned.length; i += CHUNK) {
      const slice = cleaned.slice(i, i + CHUNK);
      const { error, count } = await sb.from(reg.physical_table).insert(slice, { count: "exact" });
      if (error) {
        return NextResponse.json(
          { error: error.message, inserted, errors },
          { status: 400 },
        );
      }
      inserted += count ?? slice.length;
    }
  }

  return NextResponse.json({ inserted, total: incoming.length, errors });
}
