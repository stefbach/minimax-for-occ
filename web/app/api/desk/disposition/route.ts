import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/disposition
 *   { call_id, disposition?, note?, next_callback_at?, qualification? }
 *
 * End-of-call wrap-up writer. Stamps calls.disposition (and
 * qualification in metadata), appends a note into metadata.notes[],
 * and optionally sets metadata.human_callback_at when the agent asks
 * to be called back later. Idempotent — repeated POSTs append a new
 * note each time, which is the desired behaviour ("voicemail then a
 * follow-up an hour later" = two notes on the same row).
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => null)) as {
    call_id?: string;
    disposition?: string;
    note?: string;
    next_callback_at?: string;
    qualification?: string;
  } | null;

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
    .select("id, metadata, disposition")
    .eq("id", callId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const nextMd: Record<string, unknown> = { ...md };

  if (body?.qualification && body.qualification.trim()) {
    nextMd.qualification = body.qualification.trim();
  }
  if (body?.note && body.note.trim()) {
    const existing = Array.isArray(md.notes) ? (md.notes as unknown[]) : [];
    nextMd.notes = [
      ...existing,
      {
        at: new Date().toISOString(),
        by_user_id: user.id,
        text: body.note.trim(),
      },
    ];
    nextMd.note = body.note.trim(); // shortcut for the most recent note
  }
  if (body?.next_callback_at && body.next_callback_at.trim()) {
    // Accept ISO or a local datetime-string from <input type="datetime-local">.
    const ts = Date.parse(body.next_callback_at);
    if (Number.isFinite(ts)) {
      nextMd.human_callback_at = new Date(ts).toISOString();
    }
  }

  const patch: Record<string, unknown> = { metadata: nextMd };
  if (body?.disposition && body.disposition.trim()) {
    patch.disposition = body.disposition.trim();
  }

  const { error: upErr } = await admin
    .from("calls")
    .update(patch)
    .eq("id", callId)
    .eq("org_id", orgId);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Audit row in call_events so the disposition history is queryable.
  await admin.from("call_events").insert({
    call_id: callId,
    kind: "human_disposition",
    by_user_id: user.id,
    payload: {
      disposition: body?.disposition ?? null,
      qualification: body?.qualification ?? null,
      note: body?.note ?? null,
      next_callback_at: nextMd.human_callback_at ?? null,
    },
  });

  return NextResponse.json({ ok: true, call_id: callId });
}
