import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg } from "@/lib/supabase-auth";
import { isModuleId, type ModuleId } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/team/users — owner/admin creates a teammate's account directly,
// setting the password themselves (so the employee just needs the credentials,
// no link to click). Mirrors /api/admin/users but is org-scoped from the
// session (no super_admin needed).
//
// Body: { email, password, role, display_name? }
//
// Side effects:
//   1. Creates the auth user (email_confirm: true so they can sign in straight
//      away). If the email already exists in Auth, we look up the user and
//      attach a membership (treating "create" as idempotent for orgs).
//   2. Upserts the public.profiles row (email + full_name).
//   3. Inserts the public.memberships row (org_id, user_id, role).

const ALLOWED_ROLES = new Set(["owner", "admin", "manager", "agent", "viewer"]);
const MANAGER_ROLES = new Set(["super_admin", "owner", "admin"]);

export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const orgId = await currentOrgIdForServer();
  const callerRole = await currentRoleInOrg(orgId);
  if (!callerRole || !MANAGER_ROLES.has(callerRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    role?: string;
    display_name?: string;
  };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const role = body.role ?? "";
  const displayName = (body.display_name ?? "").trim() || null;

  if (!email || !password || !role) {
    return NextResponse.json({ error: "email, password et rôle requis" }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "email invalide" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "le mot de passe doit faire au moins 8 caractères" }, { status: 400 });
  }
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: `rôle invalide: ${role}` }, { status: 400 });
  }
  // Only owners can create another owner. Admins can't promote to owner.
  if (role === "owner" && callerRole !== "owner" && callerRole !== "super_admin") {
    return NextResponse.json({ error: "seul un owner peut créer un autre owner" }, { status: 403 });
  }

  const sb = supabaseServer();

  // 1) Auth user — create, or fall back to lookup if the email already exists.
  let userId: string | null = null;
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName } : undefined,
  });
  if (created?.user?.id) {
    userId = created.user.id;
  } else if (createErr && /already|exists|registered/i.test(createErr.message)) {
    // Already an Axon user — locate by paginating auth.users (no email index).
    let page = 1;
    const perPage = 200;
    for (let i = 0; i < 10 && !userId; i++) {
      const { data: pageData } = await sb.auth.admin.listUsers({ page, perPage });
      const users = pageData?.users ?? [];
      const match = users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (match) { userId = match.id; break; }
      if (users.length < perPage) break;
      page += 1;
    }
    if (!userId) {
      return NextResponse.json({ error: "utilisateur existant introuvable" }, { status: 500 });
    }
  } else if (createErr) {
    return NextResponse.json({ error: createErr.message }, { status: 500 });
  }
  if (!userId) return NextResponse.json({ error: "création du compte échouée" }, { status: 500 });

  // 2) Profile upsert.
  await sb
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        full_name: displayName,
        is_active: true,
      },
      { onConflict: "id" },
    );

  // 3) Membership: refuse if already a member of this org with a different
  //    role (owner must explicitly use the role-edit flow), otherwise insert.
  const { data: existing } = await sb
    .from("memberships")
    .select("id, role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error: "déjà membre de cette organisation",
        existing_role: (existing as { role: string }).role,
      },
      { status: 409 },
    );
  }
  const { error: memErr } = await sb
    .from("memberships")
    .insert({ org_id: orgId, user_id: userId, role });
  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user_id: userId,
    email,
    role,
    display_name: displayName,
  });
}
