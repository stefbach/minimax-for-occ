import { NextResponse } from "next/server";
import { supabaseSession } from "@/lib/supabase-auth";
import { supabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const sb = await supabaseSession();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseServer();

  // Check if a human handle already exists.
  const { data: existing } = await admin
    .from("agent_handles")
    .select("id, org_id, display_name")
    .eq("kind", "human")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (existing) return NextResponse.json(existing);

  // Pick the user's first membership for the org context.
  const { data: membership, error: mErr } = await admin
    .from("memberships")
    .select("org_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }
  if (!membership) {
    return NextResponse.json({ error: "no_membership" }, { status: 400 });
  }

  const emailPrefix = (user.email ?? "").split("@")[0] || "Agent";
  const displayName =
    (user.user_metadata as { full_name?: string; name?: string } | null)?.full_name ??
    (user.user_metadata as { full_name?: string; name?: string } | null)?.name ??
    emailPrefix;

  const { data, error } = await admin
    .from("agent_handles")
    .insert({
      org_id: membership.org_id,
      kind: "human",
      user_id: user.id,
      display_name: displayName,
      active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
