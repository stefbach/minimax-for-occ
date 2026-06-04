import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentOrgIdForServer, currentRoleInOrg, currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Wave B — team invitations.
// Owner/admin/super_admin only. Tokens are random UUIDv4, valid for 14 days.
// We never send email here (manual share-link UX) — the UI displays the URL
// and offers a "copy" button.

const MANAGER_ROLES = new Set(["super_admin", "owner", "admin"]);
const ALLOWED_ROLES = new Set(["owner", "admin", "manager", "agent", "viewer"]);

export type PendingInvitation = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
  accept_url: string;
};

export type InvitesListResponse = { invitations: PendingInvitation[] };

function originOf(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

function buildAcceptUrl(req: Request, token: string): string {
  return `${originOf(req)}/signup?token=${encodeURIComponent(token)}`;
}

async function gate(): Promise<
  | { ok: true; orgId: string; userId: string }
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
  return { ok: true, orgId, userId: user.id };
}

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const sb = supabaseServer();
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("invitations")
    .select("id, email, role, token, expires_at, created_at")
    .eq("org_id", g.orgId)
    .is("accepted_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const invitations: PendingInvitation[] = (data ?? []).map((r) => ({
    id: r.id as string,
    email: r.email as string,
    role: r.role as string,
    expires_at: r.expires_at as string,
    created_at: r.created_at as string,
    accept_url: buildAcceptUrl(req, r.token as string),
  }));
  return NextResponse.json({ invitations } satisfies InvitesListResponse);
}

export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;

  const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const role = (body.role ?? "agent").trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "email invalide" }, { status: 400 });
  }
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "rôle invalide" }, { status: 400 });
  }

  const sb = supabaseServer();

  // Reject if an active member already exists in this org with that email.
  const { data: existingProfile } = await sb
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile?.id) {
    const { data: existingMembership } = await sb
      .from("memberships")
      .select("id")
      .eq("org_id", g.orgId)
      .eq("user_id", existingProfile.id)
      .maybeSingle();
    if (existingMembership) {
      return NextResponse.json(
        { error: "Cet utilisateur est déjà membre de l'organisation." },
        { status: 409 },
      );
    }
  }

  // Reject if a non-expired pending invitation already exists.
  const nowIso = new Date().toISOString();
  const { data: existingInvite } = await sb
    .from("invitations")
    .select("id, token, expires_at")
    .eq("org_id", g.orgId)
    .eq("email", email)
    .is("accepted_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (existingInvite) {
    return NextResponse.json(
      {
        error: "Une invitation est déjà en attente pour cet email.",
        token: existingInvite.token,
        accept_url: buildAcceptUrl(req, existingInvite.token as string),
        id: existingInvite.id,
      },
      { status: 409 },
    );
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("invitations")
    .insert({
      org_id: g.orgId,
      email,
      role,
      token,
      invited_by: g.userId,
      expires_at: expiresAt,
    })
    .select("id, email, role, expires_at, created_at, token")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    {
      id: data.id as string,
      email: data.email as string,
      role: data.role as string,
      expires_at: data.expires_at as string,
      created_at: data.created_at as string,
      token: data.token as string,
      accept_url: buildAcceptUrl(req, data.token as string),
    },
    { status: 201 },
  );
}
