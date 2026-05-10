import { NextResponse } from "next/server";
import { listN8nWorkflows } from "@/lib/n8n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const activeParam = searchParams.get("active");
  const opts: { active?: boolean } = {};
  if (activeParam === "true") opts.active = true;
  else if (activeParam === "false") opts.active = false;
  try {
    const data = await listN8nWorkflows(opts);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
