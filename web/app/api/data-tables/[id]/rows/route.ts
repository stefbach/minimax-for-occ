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

  // Server-side search (Wati 2026-06-12): the CRM page loads a bounded
  // window of recent rows, so client-side filtering can't find older
  // leads ("Quiche Lorraine", created Dec 2025, was invisible). With
  // ?q=<term> we search the WHOLE physical table on the registered name
  // + phone columns and return the matches — the client swaps its list
  // for these results while a search is active.
  //
  // Pagination (Wati 2026-06-15): the CRM was rendering the whole table
  // in one shot — 7800+ rows for OCC's leads_rdv tanked the browser.
  // Both branches (search + default listing) now accept ?page= and
  // ?per_page= so the client can render a small window at a time.
  // per_page=0 (or "all") asks for everything up to a hard cap.
  const url = new URL(req.url);
  const searchTerm = (url.searchParams.get("q") ?? "").trim();
  const pageRaw = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const perPageRaw = url.searchParams.get("per_page");
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  // "all" / "0" / unspecified-large → fall back to the hard cap (10k for
  // the listing path, 1k for search). Otherwise clamp to [1, 500].
  const HARD_CAP_LIST = 10000;
  const HARD_CAP_SEARCH = 1000;
  const perPageWanted = perPageRaw === null
    ? 20
    : perPageRaw === "all" || perPageRaw === "0"
      ? HARD_CAP_LIST
      : Math.max(1, Math.min(500, Number.parseInt(perPageRaw, 10) || 20));

  if (searchTerm) {
    // Strip the characters that have meaning in PostgREST or-filters so a
    // user typing "%" or "," can't break out of the pattern.
    const safe = searchTerm.replace(/[%_,()]/g, " ").trim();
    const pattern = `%${safe}%`;
    const orParts = [
      reg.name_column ? `${reg.name_column}.ilike.${pattern}` : null,
      reg.phone_column ? `${reg.phone_column}.ilike.${pattern}` : null,
    ].filter(Boolean) as string[];
    const perPageS = Math.min(perPageWanted, HARD_CAP_SEARCH);
    const from = (page - 1) * perPageS;
    const to = from + perPageS - 1;
    let sq = sb
      .from(reg.physical_table)
      .select("*", { count: "exact" })
      .range(from, to);
    if (orParts.length > 0) sq = sq.or(orParts.join(","));
    const { data: found, count, error: sErr } = await sq;
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
    return NextResponse.json({
      table: reg,
      rows: found ?? [],
      total: count ?? (found?.length ?? 0),
      page,
      per_page: perPageS,
      search: searchTerm,
    });
  }

  const perPageL = Math.min(perPageWanted, HARD_CAP_LIST);
  const from = (page - 1) * perPageL;
  const to = from + perPageL - 1;
  let q = sb
    .from(reg.physical_table)
    .select("*", { count: "exact" })
    .range(from, to);
  if (orderCol) q = q.order(orderCol, { ascending: false, nullsFirst: false });
  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    table: reg,
    rows: data ?? [],
    total: count ?? (data?.length ?? 0),
    page,
    per_page: perPageL,
  });
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
