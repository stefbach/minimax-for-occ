import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * The rate limiter stores state in a module-level Map keyed by the caller's
 * key. We use vi.useFakeTimers + Date mocking to deterministically advance
 * past the 60s window, and we change keys per-test to avoid cross-test bleed
 * (the module is loaded once for the whole suite).
 */
describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the first request and decrements remaining", () => {
    const r = rateLimit("rl-first", 3);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.resetAt).toBeGreaterThan(Date.now());
  });

  it("throttles once the limit is reached", () => {
    const key = "rl-throttle";
    const limit = 2;
    expect(rateLimit(key, limit).ok).toBe(true);
    expect(rateLimit(key, limit).ok).toBe(true);
    const blocked = rateLimit(key, limit);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after the window expires", () => {
    const key = "rl-reset";
    rateLimit(key, 1); // consume the only slot
    expect(rateLimit(key, 1).ok).toBe(false);

    // Advance just past the 60s window
    vi.advanceTimersByTime(60_001);
    const r = rateLimit(key, 1);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0); // limit=1, fresh bucket counted as 1
  });

  it("keeps different keys isolated", () => {
    const limit = 1;
    expect(rateLimit("rl-iso-A", limit).ok).toBe(true);
    expect(rateLimit("rl-iso-A", limit).ok).toBe(false);
    // Different key gets its own bucket
    expect(rateLimit("rl-iso-B", limit).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("returns the first IP from x-forwarded-for", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const req = new Request("https://example.com", {
      headers: { "x-real-ip": "5.6.7.8" },
    });
    expect(clientIp(req)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when no header is present", () => {
    const req = new Request("https://example.com");
    expect(clientIp(req)).toBe("unknown");
  });
});
