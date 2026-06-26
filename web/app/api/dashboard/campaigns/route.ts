import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const orgId = await requestOrgId(request);
  const sb = supabaseServer();

  const { data, error } = await sb
    .from("campaigns")
    .select("id, name")
    .eq("org_id", orgId)
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ campaigns: data ?? [] });
}
