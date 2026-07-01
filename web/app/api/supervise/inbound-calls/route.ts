import { NextResponse } from "next/server";
import { supabaseSession, currentRoleInOrg } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPERVISOR_ROLES = new Set([
  "super_admin",
  "owner",
  "admin",
  "manager",
  "supervisor",
]);

/**
 * GET /api/supervise/inbound-calls
 *
 * Inbound PSTN call list for the supervisor's inbound tracking page.
 * Filters out softphone test calls (from_e164 like 'client:%').
 * Defaults to today (UTC midnight → now). Supports ?from=ISO&to=ISO&state=...
 *
 * Returns:
 *   { calls: InboundCall[], kpis: KPIs, period: { from, to } }
 */
export async function GET(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ calls: [], kpis: null, period: null });
  }

  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const orgId = await requestOrgId(req);
  const role = await currentRoleInOrg(orgId);
  if (!role || !SUPERVISOR_ROLES.has(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const stateFilter = searchParams.get("state");
  const limit = Math.min(Number(searchParams.get("limit") ?? 300), 1000);

  // Default: today UTC
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const fromDate = searchParams.get("from") ?? todayStart.toISOString();
  const toDate = searchParams.get("to") ?? new Date().toISOString();

  const admin = supabaseServer();

  let q = admin
    .from("calls")
    .select(
      "id, state, from_e164, to_e164, started_at, answered_at, ended_at, duration_secs, disposition, metadata, agent_handle_id, contact_id, recording_url, transcript_url, phone_number_id, contacts(id, display_name, e164), agent_handles(id, display_name, kind)",
    )
    .eq("org_id", orgId)
    .eq("direction", "in")
    // Exclude softphone / LiveKit internal calls — only real PSTN inbound.
    .not("from_e164", "like", "client:%")
    .gte("started_at", fromDate)
    .lte("started_at", toDate)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (stateFilter) {
    const states = stateFilter.split(",").map((s) => s.trim()).filter(Boolean);
    if (states.length > 0) q = q.in("state", states);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type RawCall = {
    id: string;
    state: string;
    from_e164: string | null;
    to_e164: string | null;
    started_at: string;
    answered_at: string | null;
    ended_at: string | null;
    duration_secs: number | null;
    disposition: string | null;
    metadata: { qualification?: string } | null;
    agent_handle_id: string | null;
    contact_id: string | null;
    recording_url: string | null;
    transcript_url: string | null;
    phone_number_id: string | null;
    contacts: { id: string; display_name: string | null; e164: string | null } | Array<{ id: string; display_name: string | null; e164: string | null }> | null;
    agent_handles: { id: string; display_name: string | null; kind: string } | Array<{ id: string; display_name: string | null; kind: string }> | null;
  };

  // Intermediate type keeping phone_number_id for the secondary AI-agent lookup.
  type MappedCall = {
    id: string;
    state: string;
    from_e164: string | null;
    to_e164: string | null;
    started_at: string;
    answered_at: string | null;
    ended_at: string | null;
    duration_secs: number | null;
    disposition: string | null;
    qualification: string | null;
    contact_id: string | null;
    contact_name: string | null;
    contact_e164: string | null;
    agent_name: string | null;
    agent_kind: string | null;
    recording_url: string | null;
    transcript_url: string | null;
    _phone_number_id: string | null;
  };

  const calls: MappedCall[] = ((data ?? []) as RawCall[]).map((c) => {
    const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
    const handle = Array.isArray(c.agent_handles) ? c.agent_handles[0] : c.agent_handles;
    return {
      id: c.id,
      state: c.state,
      from_e164: c.from_e164,
      to_e164: c.to_e164,
      started_at: c.started_at,
      answered_at: c.answered_at,
      ended_at: c.ended_at,
      duration_secs: c.duration_secs,
      disposition: c.disposition,
      qualification: c.metadata?.qualification ?? null,
      // contact_id from FK join only — secondary lookups won't set this
      // because there is no individual contact detail page to link to.
      contact_id: contact?.id ?? c.contact_id ?? null,
      contact_name: contact?.display_name ?? null,
      contact_e164: contact?.e164 ?? null,
      agent_name: handle?.display_name ?? null,
      agent_kind: handle?.kind ?? null,
      recording_url: c.recording_url ?? null,
      transcript_url: c.transcript_url ?? null,
      _phone_number_id: c.phone_number_id ?? null,
    };
  });

  // ── Secondary lookups ────────────────────────────────────────────────────

  // 1. Caller name: contacts table by e164, then leads_rdv by phone.
  //    contact_id is NOT set from these lookups (no individual contact page).
  const needsNameLookup = calls.filter((c) => !c.contact_name && c.from_e164);
  if (needsNameLookup.length > 0) {
    const phones = [...new Set(needsNameLookup.map((c) => c.from_e164!))];
    const nameByPhone = new Map<string, string | null>();

    const { data: ctsRows } = await admin
      .from("contacts")
      .select("e164, display_name")
      .eq("org_id", orgId)
      .in("e164", phones);
    for (const ct of (ctsRows ?? []) as Array<{ e164: string; display_name: string | null }>) {
      if (ct.e164) nameByPhone.set(ct.e164, ct.display_name);
    }

    const missingPhones = phones.filter((p) => !nameByPhone.has(p));
    if (missingPhones.length > 0) {
      const { data: leadRows } = await admin
        .from("leads_rdv")
        .select("numero_telephone, nom")
        .in("numero_telephone", missingPhones);
      for (const l of (leadRows ?? []) as Array<{ numero_telephone: string | null; nom: string | null }>) {
        if (l.numero_telephone) nameByPhone.set(l.numero_telephone, l.nom ?? null);
      }
    }

    for (const c of calls) {
      if (!c.contact_name && c.from_e164) {
        c.contact_name = nameByPhone.get(c.from_e164) ?? null;
      }
    }
  }

  // 2. AI agent name: for calls where agent_handle_id is null, resolve via
  //    phone_numbers.agent_handle_id → agent_handles.display_name.
  //    This maps the inbound number to the AI agent configured to receive it.
  const needsAgentLookup = calls.filter((c) => !c.agent_name && c._phone_number_id);
  if (needsAgentLookup.length > 0) {
    const phoneNumIds = [...new Set(needsAgentLookup.map((c) => c._phone_number_id!))];
    const { data: phoneNums } = await admin
      .from("phone_numbers")
      .select("id, agent_handle_id")
      .in("id", phoneNumIds);

    const handleIdByPhoneNum = new Map<string, string | null>(
      (phoneNums ?? []).map((p: { id: string; agent_handle_id: string | null }) => [p.id, p.agent_handle_id]),
    );

    const handleIds = [...new Set([...handleIdByPhoneNum.values()].filter((id): id is string => !!id))];
    if (handleIds.length > 0) {
      const { data: handles } = await admin
        .from("agent_handles")
        .select("id, display_name, kind")
        .in("id", handleIds);
      const handleMap = new Map(
        (handles ?? []).map((h: { id: string; display_name: string | null; kind: string }) => [h.id, h]),
      );

      for (const c of calls) {
        if (!c.agent_name && c._phone_number_id) {
          const handleId = handleIdByPhoneNum.get(c._phone_number_id);
          if (handleId) {
            const h = handleMap.get(handleId);
            if (h) {
              c.agent_name = h.display_name;
              c.agent_kind = h.kind;
            }
          }
        }
      }
    }
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const total = calls.length;
  const answered = calls.filter((c) => c.answered_at !== null).length;
  const inProgress = calls.filter((c) => c.state === "ringing" || c.state === "in_progress").length;
  const missed = calls.filter(
    (c) => !c.answered_at && (c.state === "ended" || c.state === "failed"),
  ).length;
  const durSamples = calls.filter((c) => c.answered_at && c.duration_secs != null);
  const avgDuration =
    durSamples.length > 0
      ? Math.round(durSamples.reduce((s, c) => s + (c.duration_secs ?? 0), 0) / durSamples.length)
      : 0;
  const answerRate = total > 0 ? Math.round((answered / total) * 100) : 0;

  // Strip internal field before returning.
  const output = calls.map(({ _phone_number_id: _ph, ...rest }) => rest);

  return NextResponse.json({
    calls: output,
    kpis: { total, answered, missed, in_progress: inProgress, avg_duration_secs: avgDuration, answer_rate: answerRate },
    period: { from: fromDate, to: toDate },
  });
}
