import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/claim   { call_id: string }
 *
 * Mark a shared-pool call as owned by the current user — sets
 * calls.metadata.assigned_to = user.id. Idempotent (re-claiming by the
 * same user is a no-op). Refuses if the call is already owned by
 * someone else.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => null)) as { call_id?: string } | null;
  const callId = (body?.call_id ?? "").trim();
  if (!callId) {
    return NextResponse.json({ error: "call_id required" }, { status: 400 });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  const { data: row, error } = await admin
    .from("calls")
    .select("id, metadata")
    .eq("id", callId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const assigned = typeof md.assigned_to === "string" ? (md.assigned_to as string) : null;

  if (assigned && assigned !== user.id) {
    return NextResponse.json(
      { error: "already assigned to another user", assigned_to: assigned },
      { status: 409 },
    );
  }

  const nextMd = { ...md, assigned_to: user.id, claimed_at: new Date().toISOString() };
  const { error: upErr } = await admin
    .from("calls")
    .update({ metadata: nextMd })
    .eq("id", callId)
    .eq("org_id", orgId);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, call_id: callId });
}
