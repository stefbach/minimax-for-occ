import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { supabaseSession } from "@/lib/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set(["call", "note", "email", "sms", "ai_summary", "tag"]);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) return NextResponse.json([]);
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("contact_interactions")
    .select("id, contact_id, call_id, kind, summary, details, created_by, occurred_at")
    .eq("contact_id", id)
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré" }, { status: 500 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    summary?: string | null;
    details?: Record<string, unknown> | null;
    call_id?: string | null;
  } | null;
  if (!body?.kind || !VALID_KINDS.has(body.kind)) {
    return NextResponse.json(
      { error: `kind requis (${[...VALID_KINDS].join("|")})` },
      { status: 400 },
    );
  }

  const sb = supabaseServer();
  // Resolve org_id from the contact so we can stamp it on the interaction
  // (avoids leaking cross-org writes when the service-role client is used).
  const { data: contact, error: cErr } = await sb
    .from("contacts")
    .select("id, org_id")
    .eq("id", id)
    .maybeSingle();
  if (cErr || !contact) {
    return NextResponse.json({ error: "contact introuvable" }, { status: 404 });
  }

  const session = await supabaseSession();
  const { data: userData } = await session.auth.getUser();
  const createdBy = userData?.user?.id ?? null;

  const { data, error } = await sb
    .from("contact_interactions")
    .insert({
      org_id: contact.org_id,
      contact_id: id,
      call_id: body.call_id ?? null,
      kind: body.kind,
      summary: body.summary ?? null,
      details: body.details ?? null,
      created_by: createdBy,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
