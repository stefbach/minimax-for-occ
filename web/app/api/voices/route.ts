import { NextResponse } from "next/server";
import { supabaseServer, hasSupabase } from "@/lib/supabase";
import { cloneCartesiaVoice } from "@/lib/cartesia";
import { requestOrgId } from "@/lib/request-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!hasSupabase()) return NextResponse.json([]);
  const orgId = await requestOrgId(req);
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("voices")
    .select("*")
    .eq("org_id", orgId)
    .order("source", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/**
 * POST /api/voices  (multipart/form-data)
 *   file:           audio sample (wav/mp3/m4a, ≤20MB, single speaker)
 *   display_name:   human label shown in the UI
 *   language:       'multi' | 'fr' | 'en' | …
 *   description?:   optional notes
 *
 * Clones the voice via Cartesia's /voices/clone endpoint, then stores the
 * resulting Cartesia voice UUID in Supabase so the agent dropdown picks it up.
 */
export async function POST(req: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const orgId = await requestOrgId(req);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const displayName = String(form.get("display_name") ?? "").trim();
  const language = String(form.get("language") ?? "multi").trim() || "multi";
  const description = (form.get("description") as string | null)?.toString() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "audio file required" }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: "display_name required" }, { status: 400 });
  }
  if (file.size === 0 || file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "file too small/large (max 20MB)" }, { status: 400 });
  }

  // Clone via Cartesia — returns the new voice UUID.
  let clonedId: string;
  try {
    const result = await cloneCartesiaVoice({
      file,
      name: displayName,
      description: description ?? undefined,
      language,
    });
    clonedId = result.id;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  // Persist in Supabase so the agent form dropdown sees it.
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("voices")
    .upsert(
      {
        org_id: orgId,
        voice_id: clonedId,
        display_name: displayName,
        language,
        source: "cloned",
        description,
        metadata: { provider: "cartesia", original_filename: file.name },
      },
      { onConflict: "voice_id" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = supabaseServer();
  const { error } = await sb.from("voices").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
