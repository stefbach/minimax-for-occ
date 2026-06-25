import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg, currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/team/members/[user_id]/numbers
 *   → { numbers: [{ id, e164, label, inbound_enabled,
 *                   assigned,            // inbound (reçoit les appels)
 *                   outbound_assigned,   // sortant (peut appeler depuis)
 *                   outbound_primary }] }// sortant par défaut (caller-ID)
 *
 * PUT  /api/team/members/[user_id]/numbers
 *   body { number_ids?: string[],            // ENTRANT — numéros reçus
 *          outbound_number_ids?: string[],   // SORTANT — numéros autorisés
 *          outbound_primary_id?: string|null }// SORTANT — numéro par défaut
 *   Chaque clé est optionnelle : absente = on ne touche pas cette dimension.
 *
 * ENTRANT (inbound_number_agents) : le routing "humain d'abord" fait sonner
 * les humains assignés en ligne ; sinon l'IA (Charlotte) prend.
 * SORTANT (outbound_number_agents) : restreint le caller-ID que l'agent peut
 * utiliser pour appeler. Sans assignation → numéro par défaut de l'org.
 * Réservé aux managers/superviseurs.
 */

const ASSIGN_ROLES = new Set(["super_admin", "owner", "admin", "manager", "supervisor"]);

async function gate(): Promise<
  | { ok: true; orgId: string }
  | { ok: false; res: NextResponse }
> {
  if (!hasSupabase()) {
    return { ok: false, res: NextResponse.json({ error: "Supabase non configuré" }, { status: 500 }) };
  }
  const user = await currentUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const orgId = await currentOrgIdForServer();
  const role = await currentRoleInOrg(orgId);
  if (!role || !ASSIGN_ROLES.has(role)) {
    return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, orgId };
}

export async function GET(_req: Request, ctx: { params: Promise<{ user_id: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { user_id: targetUserId } = await ctx.params;
  const sb = supabaseServer();

  const { data: nums } = await sb
    .from("phone_numbers")
    .select("id, e164, label, inbound_enabled")
    .eq("org_id", g.orgId)
    .order("e164", { ascending: true })
    .limit(500);
  const { data: inbound } = await sb
    .from("inbound_number_agents")
    .select("phone_number_id")
    .eq("org_id", g.orgId)
    .eq("user_id", targetUserId);
  const { data: outbound } = await sb
    .from("outbound_number_agents")
    .select("phone_number_id, is_primary")
    .eq("org_id", g.orgId)
    .eq("user_id", targetUserId);

  const inboundSet = new Set(
    ((inbound ?? []) as Array<{ phone_number_id: string }>).map((r) => r.phone_number_id),
  );
  const outboundMap = new Map(
    ((outbound ?? []) as Array<{ phone_number_id: string; is_primary: boolean | null }>).map((r) => [
      r.phone_number_id,
      !!r.is_primary,
    ]),
  );

  const numbers = ((nums ?? []) as Array<{ id: string; e164: string; label: string | null; inbound_enabled: boolean | null }>).map(
    (n) => ({
      id: n.id,
      e164: n.e164,
      label: n.label,
      inbound_enabled: !!n.inbound_enabled,
      assigned: inboundSet.has(n.id),
      outbound_assigned: outboundMap.has(n.id),
      outbound_primary: outboundMap.get(n.id) ?? false,
    }),
  );
  return NextResponse.json({ numbers });
}

export async function PUT(req: Request, ctx: { params: Promise<{ user_id: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { user_id: targetUserId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    number_ids?: unknown;
    outbound_number_ids?: unknown;
    outbound_primary_id?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "body requis" }, { status: 400 });

  const asIds = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  const inboundIds = asIds(body.number_ids);
  const outboundIds = asIds(body.outbound_number_ids);
  const primaryId =
    typeof body.outbound_primary_id === "string" ? body.outbound_primary_id : null;
  if (!inboundIds && !outboundIds) {
    return NextResponse.json({ error: "number_ids ou outbound_number_ids requis" }, { status: 400 });
  }

  const sb = supabaseServer();

  // Cross-tenant fence : le membre doit appartenir à l'org.
  const { data: mem } = await sb
    .from("memberships").select("id").eq("org_id", g.orgId).eq("user_id", targetUserId).maybeSingle();
  if (!mem) return NextResponse.json({ error: "membre introuvable" }, { status: 404 });

  // ── ENTRANT (inbound_number_agents) — diff add/remove ──────────────────────
  if (inboundIds) {
    const { data: cur } = await sb
      .from("inbound_number_agents")
      .select("phone_number_id")
      .eq("org_id", g.orgId)
      .eq("user_id", targetUserId);
    const curIds = new Set(((cur ?? []) as Array<{ phone_number_id: string }>).map((r) => r.phone_number_id));
    const wanted = new Set(inboundIds);
    const toAdd = inboundIds.filter((id) => !curIds.has(id));
    const toDel = [...curIds].filter((id) => !wanted.has(id));
    if (toDel.length) {
      const { error } = await sb
        .from("inbound_number_agents")
        .delete()
        .eq("org_id", g.orgId)
        .eq("user_id", targetUserId)
        .in("phone_number_id", toDel);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (toAdd.length) {
      const { error } = await sb
        .from("inbound_number_agents")
        .insert(toAdd.map((pid) => ({ org_id: g.orgId, phone_number_id: pid, user_id: targetUserId })));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // ── SORTANT (outbound_number_agents) — full replace + primary flag ─────────
  if (outboundIds) {
    // The primary must be one of the selected numbers; otherwise default to the
    // first selected so an agent with numbers always has a default caller-ID.
    const effectivePrimary =
      primaryId && outboundIds.includes(primaryId) ? primaryId : outboundIds[0] ?? null;
    // Simplest correct approach: clear the agent's outbound set, then re-insert.
    const { error: delErr } = await sb
      .from("outbound_number_agents")
      .delete()
      .eq("org_id", g.orgId)
      .eq("user_id", targetUserId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    if (outboundIds.length) {
      const rows = outboundIds.map((pid) => ({
        org_id: g.orgId,
        phone_number_id: pid,
        user_id: targetUserId,
        is_primary: pid === effectivePrimary,
      }));
      const { error: insErr } = await sb.from("outbound_number_agents").insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    inbound: inboundIds?.length ?? null,
    outbound: outboundIds?.length ?? null,
  });
}
