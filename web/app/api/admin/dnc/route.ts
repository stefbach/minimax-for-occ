import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestContext } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const E164_RE = /^\+\d{6,15}$/;

/**
 * GET  /api/admin/dnc        → list DNC entries for current org
 * POST /api/admin/dnc        → add one or more E.164 entries
 *   Body: { e164: string, reason?: string }
 *      OR { entries: Array<{ e164: string, reason?: string }> }
 */
export async function GET(request: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("dnc_lists")
    .select("id, e164, reason, added_at, added_by")
    .eq("org_id", ctx.org_id)
    .order("added_at", { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  }
  const ctx = await requestContext(request);
  if (!ctx.user_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!["super_admin", "admin", "manager"].includes(ctx.role ?? "")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { e164?: string; reason?: string; entries?: Array<{ e164: string; reason?: string }> } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rawEntries = body.entries ?? (body.e164 ? [{ e164: body.e164, reason: body.reason }] : []);
  if (rawEntries.length === 0) {
    return NextResponse.json({ error: "missing_e164" }, { status: 400 });
  }

  const rows: Array<{ org_id: string; e164: string; reason: string | null; added_by: string }> = [];
  for (const entry of rawEntries) {
    const e164 = (entry.e164 ?? "").trim();
    if (!E164_RE.test(e164)) {
      return NextResponse.json(
        { error: `invalid_e164: ${e164}` },
        { status: 400 },
      );
    }
    rows.push({
      org_id: ctx.org_id,
      e164,
      reason: entry.reason?.trim() || null,
      added_by: ctx.user_id,
    });
  }

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("dnc_lists")
    .upsert(rows, { onConflict: "org_id,e164" })
    .select("id, e164, reason, added_at, added_by");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? [], { status: 201 });
}
