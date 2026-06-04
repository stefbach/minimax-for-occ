import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Marks a voicemail/short call as recalled by stamping
// calls.metadata.recalled_at = now(). Org-scoped: only updates rows where
// org_id matches the resolved request org.

export async function POST(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const orgId = await requestOrgId(request);
  const sb = supabaseServer();
  let body: { call_id?: string } = {};
  try {
    body = (await request.json()) as { call_id?: string };
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const callId = body.call_id;
  if (!callId) return NextResponse.json({ error: "call_id required" }, { status: 400 });

  // Read existing metadata then merge — keeps any other flags intact.
  const { data: existing, error: readErr } = await sb
    .from("calls")
    .select("id, metadata")
    .eq("id", callId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const meta = (existing as { metadata: Record<string, unknown> | null }).metadata ?? {};
  const nextMeta = { ...meta, recalled_at: new Date().toISOString() };
  const { error: upErr } = await sb
    .from("calls")
    .update({ metadata: nextMeta })
    .eq("id", callId)
    .eq("org_id", orgId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
