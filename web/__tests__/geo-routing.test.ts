import { describe, it, expect } from "vitest";
import {
  pickFromNumber,
  NoPhoneNumberError,
  type PhoneNumberPick,
} from "@/lib/geo-routing";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase query builder used in pickFromNumber chains:
 *   sb.from(table).select(cols).eq(…).eq(…).order(…).order(…).limit(n)
 *
 * We model this with a tiny fake that captures the chain into a "filters"
 * dict and resolves to a configurable `data` array. Each call to
 * pickFromNumber issues up to 3 successive queries — we feed those responses
 * via a per-test queue.
 */
type Filters = Record<string, unknown>;
type QueryResult = { data: PhoneNumberPick[] | null; error: { message: string } | null };

function makeSupabase(queue: QueryResult[]): { sb: SupabaseClient; calls: Filters[] } {
  const calls: Filters[] = [];

  function builder(filters: Filters) {
    const api: Record<string, unknown> = {
      eq(col: string, val: unknown) {
        return builder({ ...filters, [col]: val });
      },
      order(_col: string, _opts: unknown) {
        return builder(filters);
      },
      limit(_n: number) {
        calls.push(filters);
        const next = queue.shift() ?? { data: [], error: null };
        return Promise.resolve(next);
      },
    };
    return api;
  }

  const sb = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return builder({});
        },
      };
    },
  } as unknown as SupabaseClient;

  return { sb, calls };
}

const ROW = (overrides: Partial<PhoneNumberPick> = {}): PhoneNumberPick => ({
  id: "00000000-0000-0000-0000-000000000001",
  org_id: "org-1",
  e164: "+33123456789",
  label: "FR line",
  country_code: "FR",
  prefix: "+33",
  is_default: false,
  active: true,
  ...overrides,
});

describe("pickFromNumber", () => {
  it("returns the country match when one is available", async () => {
    const fr = ROW({ country_code: "FR", e164: "+33112223344" });
    const { sb, calls } = makeSupabase([{ data: [fr], error: null }]);

    const pick = await pickFromNumber(sb, "org-1", "+33756123456");
    expect(pick).toEqual(fr);
    // First query should have filtered by country FR
    expect(calls[0]).toMatchObject({ org_id: "org-1", active: true, country_code: "FR" });
  });

  it("falls back to the org default when no country match", async () => {
    const def = ROW({ country_code: "GB", is_default: true, e164: "+44123" });
    const { sb, calls } = makeSupabase([
      { data: [], error: null }, // country query empty
      { data: [def], error: null }, // default query hits
    ]);

    const pick = await pickFromNumber(sb, "org-1", "+33756123456");
    expect(pick).toEqual(def);
    expect(calls[1]).toMatchObject({ org_id: "org-1", active: true, is_default: true });
  });

  it("falls back to any active number as last resort", async () => {
    const any = ROW({ country_code: "IT", is_default: false, e164: "+39000" });
    const { sb } = makeSupabase([
      { data: [], error: null }, // country
      { data: [], error: null }, // default
      { data: [any], error: null }, // any active
    ]);

    const pick = await pickFromNumber(sb, "org-1", "+33756123456");
    expect(pick).toEqual(any);
  });

  it("throws NoPhoneNumberError when the org has no usable numbers", async () => {
    const { sb } = makeSupabase([
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]);

    await expect(pickFromNumber(sb, "org-1", "+33756123456")).rejects.toBeInstanceOf(
      NoPhoneNumberError,
    );
  });

  it("skips the country step for unknown destination prefixes", async () => {
    const def = ROW({ is_default: true });
    const { sb, calls } = makeSupabase([
      { data: [def], error: null }, // default query (country was skipped because iso is null)
    ]);

    const pick = await pickFromNumber(sb, "org-1", "+9999999999999");
    expect(pick).toEqual(def);
    // Only one call should have happened — the country branch was skipped.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ is_default: true });
  });
});
