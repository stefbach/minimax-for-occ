import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { chunkText, embedText } from "@/lib/embed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("documents")
    .select("id, agent_id, source_name, chunk_index, content, metadata, created_at")
    .eq("agent_id", id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/**
 * POST /api/agents/[id]/documents
 * body: { source_name: string, content: string }
 * Splits the content into chunks, embeds each one, stores in pgvector.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { source_name?: string; content?: string };
  if (!body.content || !body.source_name) {
    return NextResponse.json({ error: "source_name and content required" }, { status: 400 });
  }
  const chunks = chunkText(body.content);
  if (chunks.length === 0) {
    return NextResponse.json({ error: "no content after chunking" }, { status: 400 });
  }

  const embeddings = await embedText(chunks);
  const sb = supabaseServer();
  const rows = chunks.map((content, i) => ({
    agent_id: id,
    source_name: body.source_name!,
    chunk_index: i,
    content,
    embedding: embeddings[i],
  }));
  const { data, error } = await sb.from("documents").insert(rows).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inserted: data?.length ?? 0 });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const docId = searchParams.get("doc_id");
  const source = searchParams.get("source");
  const sb = supabaseServer();
  let q = sb.from("documents").delete().eq("agent_id", id);
  if (docId) q = q.eq("id", docId);
  else if (source) q = q.eq("source_name", source);
  else return NextResponse.json({ error: "doc_id or source required" }, { status: 400 });
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
