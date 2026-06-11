import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg, currentUser } from "@/lib/supabase-auth";
import { isModuleId, type ModuleId } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Wave C — edit role / disable / re-enable for a member of the current org.
//
//   PATCH   /api/team/members/[user_id]   { role?, is_active? }
//   DELETE  /api/team/members/[user_id]   → soft-delete (sets is_active=false)
//
// Guards:
//   * Caller must be owner/admin/super_admin in the current org.
//   * Caller cannot edit their own role nor disable themselves.
//   * Cannot demote the last owner (org must keep at least one owner).
//   * Target user must already be a member of the current org (no cross-org
//     leaks; we 404 if the membership doesn't exist).

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin"]);
const ALLOWED_ROLES = new Set(["owner", "admin", "manager", "supervisor", "builder", "agent", "analyst", "viewer"]);

type Body = {
  role?: string;
  is_active?: boolean;
  /** Granular per-user module allow-list. `null` (explicit) resets the user
   *  to the role default; an array sets the explicit allow-list. */
  visible_modules?: unknown;
};

async function gate(): Promise<
  | { ok: true; orgId: string; userId: string; role: string }
  | { ok: false; res: NextResponse }
> {
  if (!hasSupabase()) {
    return { ok: false, res: NextResponse.json({ error: "Supabase non configuré" }, { status: 500 }) };
  }
  const user = await currentUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const orgId = await currentOrgIdForServer();
  const role = await currentRoleInOrg(orgId);
  if (!role || !MANAGER_ROLES.has(role)) {
    return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, orgId, userId: user.id, role };
}

async function applyUpdate(
  orgId: string,
  callerId: string,
  targetUserId: string,
  body: Body,
): Promise<NextResponse> {
  const sb = supabaseServer();

  // 1. Verify the target is actually a member of this org. This is also the
  //    cross-tenant fence — anyone outside the org returns 404.
  const { data: targetMembership, error: memErr } = await sb
    .from("memberships")
    .select("id, role")
    .eq("org_id", orgId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 });
  if (!targetMembership) {
    return NextResponse.json({ error: "membre introuvable" }, { status: 404 });
  }

  const isSelf = targetUserId === callerId;
  const wantsRoleChange = typeof body.role === "string" && body.role !== targetMembership.role;
  const wantsActiveChange = typeof body.is_active === "boolean";
  const wantsModulesChange = Object.prototype.hasOwnProperty.call(body, "visible_modules");

  // 2. Self-edit guard. Users cannot change their own role or disable
  //    themselves through this endpoint (admins managing themselves leads to
  //    lock-out scenarios).
  if (isSelf && wantsRoleChange) {
    return NextResponse.json({ error: "Vous ne pouvez pas modifier votre propre rôle." }, { status: 403 });
  }
  if (isSelf && wantsActiveChange && body.is_active === false) {
    return NextResponse.json({ error: "Vous ne pouvez pas vous désactiver vous-même." }, { status: 403 });
  }

  // 3. Role validation + "last owner" check.
  if (wantsRoleChange) {
    if (!body.role || !ALLOWED_ROLES.has(body.role)) {
      return NextResponse.json({ error: "rôle invalide" }, { status: 400 });
    }
    if (targetMembership.role === "owner" && body.role !== "owner") {
      const { count } = await sb
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("role", "owner");
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: "Au moins un owner requis" }, { status: 409 });
      }
    }
    const { error: updErr } = await sb
      .from("memberships")
      .update({ role: body.role })
      .eq("org_id", orgId)
      .eq("user_id", targetUserId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // 4. Granular per-user module visibility. `null` resets to role default;
  //    an array overrides the default. Self-edits are allowed (an owner can
  //    legitimately want to hide modules from themselves while they focus on
  //    one area) but we still validate the payload server-side.
  if (wantsModulesChange) {
    let nextValue: ModuleId[] | null;
    if (body.visible_modules === null) {
      nextValue = null;
    } else if (Array.isArray(body.visible_modules)) {
      const cleaned: ModuleId[] = [];
      for (const m of body.visible_modules) {
        if (!isModuleId(m)) {
          return NextResponse.json({ error: `module inconnu: ${String(m)}` }, { status: 400 });
        }
        if (!cleaned.includes(m)) cleaned.push(m);
      }
      nextValue = cleaned;
    } else {
      return NextResponse.json({ error: "visible_modules doit être null ou un tableau" }, { status: 400 });
    }
    const { error: vmErr } = await sb
      .from("memberships")
      .update({ visible_modules: nextValue })
      .eq("org_id", orgId)
      .eq("user_id", targetUserId);
    if (vmErr) return NextResponse.json({ error: vmErr.message }, { status: 500 });
  }

  // 5. Activation state lives on profiles.is_active (Wave C uses soft delete).
  if (wantsActiveChange) {
    const { error: profErr } = await sb
      .from("profiles")
      .update({ is_active: body.is_active })
      .eq("id", targetUserId);
    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ user_id: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { user_id: targetUserId } = await ctx.params;
  if (!targetUserId) return NextResponse.json({ error: "user_id required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Body;
  return applyUpdate(g.orgId, g.userId, targetUserId, body);
}

// DELETE is the soft-delete shortcut (is_active=false). Hard delete is
// reserved for super_admin and intentionally NOT exposed yet — keeps the
// audit trail intact while we ship the MVP.
export async function DELETE(_req: Request, ctx: { params: Promise<{ user_id: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { user_id: targetUserId } = await ctx.params;
  if (!targetUserId) return NextResponse.json({ error: "user_id required" }, { status: 400 });
  return applyUpdate(g.orgId, g.userId, targetUserId, { is_active: false });
}
