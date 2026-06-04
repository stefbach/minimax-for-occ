import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";
import { nextBusinessDayAt } from "@/lib/next-business-day";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/desk/tasks/:id/complete
 *   { outcome_disposition?, notes?, next_callback_at? }
 *
 * Marks a human_callback_task as done, OR — if `next_callback_at` is
 * provided — reschedules it. When the caller passes `next_callback_at`
 * as the literal string "next_business_day" we resolve it server-side
 * via nextBusinessDayAt() so the UI doesn't have to compute the date.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    outcome_disposition?: string;
    notes?: string;
    next_callback_at?: string;
  } | null;

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const admin = supabaseServer();

  const { data: row, error } = await admin
    .from("human_callback_tasks")
    .select("id, status")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body?.outcome_disposition && body.outcome_disposition.trim()) {
    patch.outcome_disposition = body.outcome_disposition.trim();
  }
  if (body?.notes && body.notes.trim()) {
    patch.notes = body.notes.trim();
  }

  let rescheduled = false;
  if (body?.next_callback_at && body.next_callback_at.trim()) {
    let when: Date | null = null;
    if (body.next_callback_at.trim() === "next_business_day") {
      when = nextBusinessDayAt();
    } else {
      const ts = Date.parse(body.next_callback_at);
      if (Number.isFinite(ts)) when = new Date(ts);
    }
    if (when) {
      patch.scheduled_for = when.toISOString();
      patch.status = "pending";
      patch.assigned_to = null; // back to the pool for tomorrow's distribution
      rescheduled = true;
    }
  }
  if (!rescheduled) {
    patch.status = "done";
  }

  const { error: upErr } = await admin
    .from("human_callback_tasks")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, task_id: id, rescheduled });
}
