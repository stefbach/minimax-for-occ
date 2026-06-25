import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg, currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/team/members/[user_id]/numbers → { numbers: [{ id, e164, label, inbound_enabled, assigned }] }
 * PUT  /api/team/members/[user_id]/numbers   body { number_ids: string[] }
 *
 * Assigne des numéros ENTRANTS à un agent humain (table inbound_number_agents).
 * Quand un appel arrive sur un numéro, le routing "humain d'abord" fait sonner
 * les humains assignés ici qui sont en ligne ; sinon l'IA (Charlotte) prend.
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
  const { data: assigned } = await sb
    .from("inbound_number_agents")
    .select("phone_number_id")
    .eq("org_id", g.orgId)
    .eq("user_id", targetUserId);
  const assignedSet = new Set(
    ((assigned ?? []) as Array<{ phone_number_id: string }>).map((r) => r.phone_number_id),
  );

  const numbers = ((nums ?? []) as Array<{ id: string; e164: string; label: string | null; inbound_enabled: boolean | null }>).map(
    (n) => ({
      id: n.id,
      e164: n.e164,
      label: n.label,
      inbound_enabled: !!n.inbound_enabled,
      assigned: assignedSet.has(n.id),
    }),
  );
  return NextResponse.json({ numbers });
}

export async function PUT(req: Request, ctx: { params: Promise<{ user_id: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { user_id: targetUserId } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { number_ids?: unknown } | null;
  const numberIds = Array.isArray(body?.number_ids)
    ? (body!.number_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : null;
  if (!numberIds) return NextResponse.json({ error: "number_ids requis" }, { status: 400 });

  const sb = supabaseServer();

  // Cross-tenant fence : le membre doit appartenir à l'org.
  const { data: mem } = await sb
    .from("memberships").select("id").eq("org_id", g.orgId).eq("user_id", targetUserId).maybeSingle();
  if (!mem) return NextResponse.json({ error: "membre introuvable" }, { status: 404 });

  const { data: cur } = await sb
    .from("inbound_number_agents")
    .select("phone_number_id")
    .eq("org_id", g.orgId)
    .eq("user_id", targetUserId);
  const curIds = new Set(((cur ?? []) as Array<{ phone_number_id: string }>).map((r) => r.phone_number_id));
  const wanted = new Set(numberIds);
  const toAdd = numberIds.filter((id) => !curIds.has(id));
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
  return NextResponse.json({ ok: true, assigned: numberIds.length });
}
