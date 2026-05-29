import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.DEEPSEEK_API_KEY;
  const base = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

  if (!key) {
    return NextResponse.json({ ok: false, error: "DEEPSEEK_API_KEY missing" }, { status: 500 });
  }

  const results: Record<string, unknown> = {
    key_prefix: key.slice(0, 8) + "..." + key.slice(-4),
    key_length: key.length,
    base_url: base,
  };

  for (const path of ["/v1/chat/completions", "/chat/completions"]) {
    const url = base.replace(/\/$/, "") + path;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [{ role: "user", content: "say hi" }],
          stream: false,
        }),
      });
      const text = await res.text();
      results[path] = {
        url,
        status: res.status,
        statusText: res.statusText,
        body: text.slice(0, 500),
      };
    } catch (e) {
      results[path] = { url, error: String(e) };
    }
  }

  return NextResponse.json(results);
}
