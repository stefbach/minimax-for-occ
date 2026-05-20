import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { currentMembership, currentUser } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/gdpr/erase
 *
 * Body: { contact_id?: string, user_id?: string, org_id?: string }
 *
 * At least one of `contact_id`, `user_id`, `org_id` is required.
 *  · `contact_id` — deletes the contact (FK calls.contact_id → SET NULL).
 *  · `user_id`    — anonymizes the auth user (email/display_name scrambled)
 *                   and deletes their memberships. The auth row itself is
 *                   kept so historical FKs (audit logs, agent_handles) stay
 *                   valid; the data that identifies the human is gone.
 *  · `org_id`     — super_admin only. Deletes the organization which cascades
 *                   to memberships, contacts, calls, conversations, etc.
 *
 * Every erasure is audited in `public.copilot_actions` (status='executed')
 * so we have a tamper-evident trail of who erased what and when.
 *
 * Auth: requires an `admin` or `super_admin` membership for contact/user
 * erasure; `super_admin` is required to delete an entire org.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const m = await currentMembership();
  if (!m || (m.role !== "admin" && m.role !== "super_admin")) {
    return NextResponse.json({ error: "forbidden — admin only" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    contact_id?: string;
    user_id?: string;
    org_id?: string;
  };
  const { contact_id, user_id, org_id } = body;
  if (!contact_id && !user_id && !org_id) {
    return NextResponse.json(
      { error: "at least one of contact_id, user_id or org_id is required" },
      { status: 400 },
    );
  }
  if (org_id && m.role !== "super_admin") {
    return NextResponse.json(
      { error: "forbidden — super_admin required for org erasure" },
      { status: 403 },
    );
  }

  const sb = supabaseServer();
  const result: Record<string, unknown> = {};

  // Helper that records an audit row regardless of which branch ran.
  const audit = async (tool: string, args: unknown, outcome: unknown, error?: string) => {
    try {
      await sb.from("copilot_actions").insert({
        org_id: m.org_id ?? null,
        user_id: user.id,
        tool_name: tool,
        arguments: args as object,
        result: outcome as object,
        status: error ? "failed" : "executed",
        error: error ?? null,
        executed_at: new Date().toISOString(),
      });
    } catch {
      /* never let audit failure break the erasure response */
    }
  };

  // ─── 1. contact erasure ─────────────────────────────────────────
  if (contact_id) {
    const { error } = await sb.from("contacts").delete().eq("id", contact_id);
    if (error) {
      await audit("gdpr.erase_contact", { contact_id }, null, error.message);
      return NextResponse.json({ error: `contact: ${error.message}` }, { status: 500 });
    }
    result.contact_id = contact_id;
    await audit("gdpr.erase_contact", { contact_id }, { deleted: true });
  }

  // ─── 2. user anonymization ──────────────────────────────────────
  if (user_id) {
    const anonEmail = `deleted_${user_id}@axon.local`;
    const { error: updErr } = await sb.auth.admin.updateUserById(user_id, {
      email: anonEmail,
      user_metadata: { display_name: null, full_name: null, anonymized_at: new Date().toISOString() },
    });
    if (updErr) {
      await audit("gdpr.erase_user", { user_id }, null, updErr.message);
      return NextResponse.json({ error: `user: ${updErr.message}` }, { status: 500 });
    }
    const { error: memErr } = await sb.from("memberships").delete().eq("user_id", user_id);
    if (memErr) {
      await audit("gdpr.erase_user", { user_id }, { email: anonEmail }, memErr.message);
      return NextResponse.json({ error: `memberships: ${memErr.message}` }, { status: 500 });
    }
    result.user_id = user_id;
    result.anonymized_email = anonEmail;
    await audit("gdpr.erase_user", { user_id }, { anonymized: true, email: anonEmail });
  }

  // ─── 3. org cascade delete (super_admin only) ───────────────────
  if (org_id) {
    const { error } = await sb.from("organizations").delete().eq("id", org_id);
    if (error) {
      await audit("gdpr.erase_org", { org_id }, null, error.message);
      return NextResponse.json({ error: `org: ${error.message}` }, { status: 500 });
    }
    result.org_id = org_id;
    await audit("gdpr.erase_org", { org_id }, { deleted: true });
  }

  return NextResponse.json({ ok: true, ...result });
}
