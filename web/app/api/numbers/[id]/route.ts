import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { prefixForCountry } from "@/lib/phone-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/numbers/[id]
 *
 * RESTful alias of the query-param PATCH on /api/numbers. Mainly used by the
 * NumbersClient "Définir par défaut" action and country-code tweaks. Same body
 * contract:
 *   { label?, active?, flow_id?, country_code?, is_default? }
 *
 * is_default=true clears any other default in the same org to satisfy the
 * uniq_default_per_org index.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 500 });
  }
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    label?: string | null;
    active?: boolean;
    flow_id?: string | null;
    country_code?: string | null;
    is_default?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: "body requis" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.label !== undefined) patch.label = body.label;
  if (body.active !== undefined) patch.active = body.active;
  if (body.flow_id !== undefined) patch.flow_id = body.flow_id;
  if (body.country_code !== undefined) {
    const cc = body.country_code ? body.country_code.toUpperCase() : null;
    patch.country_code = cc;
    patch.prefix = prefixForCountry(cc);
  }
  if (body.is_default !== undefined) patch.is_default = body.is_default;

  const sb = supabaseServer();

  if (body.is_default === true) {
    const { data: target, error: fErr } = await sb
      .from("phone_numbers")
      .select("org_id")
      .eq("id", id)
      .single();
    if (fErr || !target) {
      return NextResponse.json({ error: fErr?.message ?? "numéro introuvable" }, { status: 404 });
    }
    const { error: clearErr } = await sb
      .from("phone_numbers")
      .update({ is_default: false })
      .eq("org_id", target.org_id)
      .eq("is_default", true)
      .neq("id", id);
    if (clearErr) {
      return NextResponse.json({ error: clearErr.message }, { status: 500 });
    }
  }

  const { data, error } = await sb
    .from("phone_numbers")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
