type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
const buckets = new Map<string, Bucket>();

/**
 * Best-effort fixed-window rate limiter, in-memory per Node.js instance.
 * Good enough for a single Vercel region under light traffic; for production
 * scale or multi-region, replace with Upstash Redis / @vercel/kv.
 */
export function rateLimit(key: string, limit: number): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    const fresh = { count: 1, resetAt: now + WINDOW_MS };
    buckets.set(key, fresh);
    return { ok: true, remaining: limit - 1, resetAt: fresh.resetAt };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, resetAt: b.resetAt };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, resetAt: b.resetAt };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
