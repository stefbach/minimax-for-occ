import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentUser } from "@/lib/supabase-auth";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns true if the calling user has at least one `super_admin` membership.
 *  Falls back to false when Supabase is unavailable. */
async function assertSuperAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; res: NextResponse }
> {
  if (!hasSupabase()) {
    return { ok: false, res: NextResponse.json({ error: "supabase unavailable" }, { status: 503 }) };
  }
  const user = await currentUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const sb = supabaseServer();
  const { data: myRoles } = await sb
    .from("memberships")
    .select("role")
    .eq("user_id", user.id);
  const isSuper = (myRoles ?? []).some((r: { role: string }) => r.role === "super_admin");
  if (!isSuper) {
    return { ok: false, res: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, userId: user.id };
}

function slugify(input: string, suffix: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";
  return `${base}-${suffix}`;
}

/** Generates a 16-char URL-safe random password for auto-provisioned owners. */
function generatePassword(): string {
  return randomBytes(12).toString("base64url");
}

const ALLOWED_STATUS = ["active", "suspended", "archived", "pending_deletion"] as const;
type OrgStatus = (typeof ALLOWED_STATUS)[number];
const DELETION_GRACE_DAYS = 30;

/**
 * GET /api/admin/orgs
 *
 * Super-admin only. Returns every organization with its member count, last-7d
 * call count, lifecycle status and category.
 */
export async function GET() {
  if (!hasSupabase()) return NextResponse.json([]);
  const gate = await assertSuperAdmin();
  if (!gate.ok) return gate.res;

  const sb = supabaseServer();
  const { data: orgs, error } = await sb
    .from("organizations")
    .select("id, name, slug, category, created_at, active, status, deletion_scheduled_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const rows = await Promise.all(
    (orgs ?? []).map(async (o) => {
      const [mem, calls] = await Promise.all([
        sb.from("memberships").select("id", { count: "exact", head: true }).eq("org_id", o.id),
        sb
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("org_id", o.id)
          .gte("started_at", since),
      ]);
      return {
        ...o,
        members: mem.count ?? 0,
        calls_7d: calls.count ?? 0,
      };
    }),
  );

  return NextResponse.json(rows);
}

/**
 * POST /api/admin/orgs
 *   { name, slug?, category?, owner_email?, owner_password?, owner_name? }
 *
 * Super-admin only. Creates a new client organization. When `owner_email` is
 * supplied, also provisions a Supabase auth user (or reuses an existing one
 * matching the email) and assigns them the `owner` role in the new org.
 *
 * If `owner_password` is omitted, a random 16-char URL-safe password is
 * generated and returned ONCE in the response so the super_admin can forward
 * it to the owner. The password is not stored anywhere on our side.
 *
 * All actions are recorded in audit_log.
 */
export async function POST(req: Request) {
  const gate = await assertSuperAdmin();
  if (!gate.ok) return gate.res;

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    slug?: string;
    category?: string;
    owner_email?: string;
    owner_password?: string;
    owner_name?: string;
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "missing name" }, { status: 400 });
  }
  const slug = (body.slug ?? "").trim() ||
    slugify(name, Math.random().toString(36).slice(2, 8));
  const category = (body.category ?? "").trim() || null;
  const ownerEmail = (body.owner_email ?? "").trim().toLowerCase() || null;
  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return NextResponse.json({ error: "invalid owner_email" }, { status: 400 });
  }

  const sb = supabaseServer();

  // 1) Create the org row.
  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .insert({ name, slug, category, status: "active" })
    .select()
    .single();
  if (orgErr) {
    return NextResponse.json({ error: orgErr.message }, { status: 500 });
  }

  await logAudit({
    orgId: org.id,
    actorUserId: gate.userId,
    actorRole: "super_admin",
    action: "org.created",
    resourceType: "organization",
    resourceId: org.id,
    metadata: { name, slug, category, has_owner: !!ownerEmail },
    req,
  });

  // 2) Optionally provision the owner.
  let ownerCredentials: { email: string; password: string; created: boolean } | null = null;

  if (ownerEmail) {
    const password = (body.owner_password ?? "").trim() || generatePassword();
    if (password.length < 8) {
      return NextResponse.json(
        { error: "owner_password must be at least 8 characters", organization: org },
        { status: 400 },
      );
    }

    // Try to create the auth user; reuse if it already exists.
    let ownerUserId: string | null = null;
    let createdUser = false;
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
      user_metadata: body.owner_name ? { display_name: body.owner_name.trim() } : undefined,
    });
    if (created?.user?.id) {
      ownerUserId = created.user.id;
      createdUser = true;
    } else if (createErr && /already/i.test(createErr.message)) {
      // Existing user — locate by listing pages (Supabase lacks a direct
      // "find by email" admin endpoint).
      for (let page = 1; page <= 10 && !ownerUserId; page++) {
        const { data: pageData } = await sb.auth.admin.listUsers({ page, perPage: 200 });
        const users = pageData?.users ?? [];
        const match = users.find((u) => u.email?.toLowerCase() === ownerEmail);
        if (match) { ownerUserId = match.id; break; }
        if (users.length < 200) break;
      }
      if (!ownerUserId) {
        return NextResponse.json(
          { error: "owner already exists but could not be located", organization: org },
          { status: 500 },
        );
      }
    } else if (createErr) {
      return NextResponse.json(
        { error: `owner creation failed: ${createErr.message}`, organization: org },
        { status: 500 },
      );
    }

    if (ownerUserId) {
      // Upsert the membership as owner.
      const { error: memErr } = await sb
        .from("memberships")
        .upsert(
          { org_id: org.id, user_id: ownerUserId, role: "owner" },
          { onConflict: "org_id,user_id" },
        );
      if (memErr) {
        return NextResponse.json(
          { error: `owner membership failed: ${memErr.message}`, organization: org },
          { status: 500 },
        );
      }

      await logAudit({
        orgId: org.id,
        actorUserId: gate.userId,
        actorRole: "super_admin",
        action: createdUser ? "user.invited" : "membership.created",
        resourceType: "membership",
        resourceId: ownerUserId,
        metadata: { email: ownerEmail, role: "owner", user_existed: !createdUser },
        req,
      });

      ownerCredentials = {
        email: ownerEmail,
        password: createdUser ? password : "(existing account — password unchanged)",
        created: createdUser,
      };
    }
  }

  return NextResponse.json(
    { ok: true, organization: org, owner: ownerCredentials },
    { status: 201 },
  );
}

/**
 * PATCH /api/admin/orgs   { id, status? , active? }
 *
 * Super-admin only. Updates the org lifecycle state.
 *
 *   status='active'              → reactivate (clears deletion_scheduled_at)
 *   status='suspended'           → login blocked, data preserved, billing on
 *   status='archived'            → read-only, no billing
 *   status='pending_deletion'    → schedules a hard-delete in 30 days
 *
 * For backward compatibility, a legacy { id, active: bool } payload is still
 * accepted and translated to status='active'/'suspended'.
 */
export async function PATCH(req: Request) {
  const gate = await assertSuperAdmin();
  if (!gate.ok) return gate.res;

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    active?: boolean;
  };
  const id = (body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  let status: OrgStatus;
  if (body.status) {
    if (!ALLOWED_STATUS.includes(body.status as OrgStatus)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    status = body.status as OrgStatus;
  } else if (typeof body.active === "boolean") {
    status = body.active ? "active" : "suspended";
  } else {
    return NextResponse.json({ error: "missing status or active" }, { status: 400 });
  }

  const update: { status: OrgStatus; deletion_scheduled_at: string | null } = {
    status,
    deletion_scheduled_at:
      status === "pending_deletion"
        ? new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 3600 * 1000).toISOString()
        : null,
  };

  const sb = supabaseServer();
  const { data, error } = await sb
    .from("organizations")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit({
    orgId: id,
    actorUserId: gate.userId,
    actorRole: "super_admin",
    action: `org.${status}`,
    resourceType: "organization",
    resourceId: id,
    metadata: { new_status: status, deletion_scheduled_at: update.deletion_scheduled_at },
    req,
  });

  return NextResponse.json({ ok: true, organization: data });
}
