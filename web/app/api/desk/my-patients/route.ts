import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/desk/my-patients?q=&status=&qualification=&offset=&limit=
 *
 * Zoho-style CRM list of patients the current human agent has worked
 * with — derived from human_callback_tasks where assigned_to=me, grouped
 * by contact, surfaced as one row per patient with the most recent
 * task's state.
 *
 * Query params:
 *   q             optional case-insensitive search across name/e164
 *   status        optional task status filter (pending|in_progress|done)
 *   qualification optional qualification filter (free-text match)
 *   offset        default 0
 *   limit         default 50 (max 200)
 */

interface PatientRow {
  contact_id: string | null;
  display_name: string | null;
  e164: string | null;
  last_task_id: string;
  last_status: string;
  last_qualification: string | null;
  last_scheduled_for: string;
  last_updated_at: string;
  task_count: number;
}

const SELECT =
  "id, contact_id, qualification, scheduled_for, status, updated_at, contacts(display_name, e164)";

export async function GET(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ patients: [], total: 0 });
  }
  const sbSession = await supabaseSession();
  const { data: auth } = await sbSession.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const orgId = await requestOrgId(req);

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status") || "";
  const qualification = url.searchParams.get("qualification") || "";
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0"));
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));

  const admin = supabaseServer();

  // Pull the agent's tasks (history-wide). We aggregate client-side
  // because Supabase doesn't expose DISTINCT ON over PostgREST.
  let qb = admin
    .from("human_callback_tasks")
    .select(SELECT)
    .eq("org_id", orgId)
    .eq("assigned_to", user.id)
    .order("updated_at", { ascending: false })
    .limit(2000); // generous cap; we paginate after grouping

  if (status) qb = qb.eq("status", status);
  if (qualification) qb = qb.ilike("qualification", `%${qualification}%`);

  const { data: rows, error } = await qb;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Raw = {
    id: string;
    contact_id: string | null;
    qualification: string | null;
    scheduled_for: string;
    status: string;
    updated_at: string;
    // Supabase's PostgREST returns embedded relationships as arrays even
    // when only a single row matches; unwrap here to keep call sites tidy.
    contacts: { display_name: string | null; e164: string | null }[] | null;
  };

  const byContact = new Map<string, PatientRow>();
  for (const r of (rows ?? []) as unknown as Raw[]) {
    const key = r.contact_id || `task:${r.id}`;
    const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    const existing = byContact.get(key);
    if (!existing) {
      byContact.set(key, {
        contact_id: r.contact_id,
        display_name: contact?.display_name ?? null,
        e164: contact?.e164 ?? null,
        last_task_id: r.id,
        last_status: r.status,
        last_qualification: r.qualification,
        last_scheduled_for: r.scheduled_for,
        last_updated_at: r.updated_at,
        task_count: 1,
      });
    } else {
      existing.task_count += 1;
      // Already sorted desc, so existing is freshest — just keep counting.
    }
  }

  let patients = Array.from(byContact.values());

  // Text search across name + phone.
  if (q) {
    const needle = q.toLowerCase();
    patients = patients.filter((p) => {
      return (
        (p.display_name ?? "").toLowerCase().includes(needle) ||
        (p.e164 ?? "").toLowerCase().includes(needle)
      );
    });
  }

  const total = patients.length;
  const paged = patients.slice(offset, offset + limit);
  return NextResponse.json({ patients: paged, total });
}
