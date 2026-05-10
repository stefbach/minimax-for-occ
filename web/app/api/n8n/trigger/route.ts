import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = process.env.N8N_BASE_URL?.replace(/\/$/, "");
const WEBHOOK_BASE = (process.env.N8N_WEBHOOK_BASE_URL ?? `${BASE}/webhook`).replace(/\/$/, "");

export async function POST(req: Request) {
  if (!BASE) {
    return NextResponse.json({ error: "N8N_BASE_URL missing" }, { status: 500 });
  }

  const { webhook_path, payload } = (await req.json()) as {
    webhook_path: string;
    payload?: unknown;
  };
  if (!webhook_path) {
    return NextResponse.json({ error: "webhook_path required" }, { status: 400 });
  }

  const url = `${WEBHOOK_BASE}/${webhook_path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return NextResponse.json({ status: res.status, data }, { status: res.ok ? 200 : 502 });
}

export async function GET() {
  if (!BASE || !process.env.N8N_API_KEY) {
    return NextResponse.json({ error: "N8N_BASE_URL or N8N_API_KEY missing" }, { status: 500 });
  }
  const res = await fetch(`${BASE}/api/v1/workflows?active=true`, {
    headers: { "X-N8N-API-KEY": process.env.N8N_API_KEY },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json({ error: "n8n list failed", status: res.status }, { status: 502 });
  }
  const json = (await res.json()) as { data?: unknown[] };
  return NextResponse.json(json.data ?? []);
}
