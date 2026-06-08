import { describe, it, expect } from "vitest";
import { fetchAllPaged, type Rangeable } from "@/lib/supabase-page";

// Simulate PostgREST's 1000-row cap: each .range() call returns at most
// `cap` rows from a backing array, exactly like the data API does.
function fakeTable<T>(all: T[], cap = 1000): () => Rangeable<T> {
  return () => ({
    range: (from: number, to: number) => {
      const end = Math.min(to + 1, from + cap);
      return Promise.resolve({ data: all.slice(from, end), error: null });
    },
  });
}

describe("fetchAllPaged", () => {
  it("pages past the 1000-row cap to read every row", async () => {
    const all = Array.from({ length: 7534 }, (_, i) => ({ n: i }));
    const { rows, error } = await fetchAllPaged(fakeTable(all));
    expect(error).toBeNull();
    expect(rows.length).toBe(7534); // not truncated to 1000
  });

  it("stops on a short final page", async () => {
    const all = Array.from({ length: 1500 }, (_, i) => ({ n: i }));
    const { rows } = await fetchAllPaged(fakeTable(all));
    expect(rows.length).toBe(1500);
  });

  it("respects maxRows and surfaces errors", async () => {
    const all = Array.from({ length: 5000 }, (_, i) => ({ n: i }));
    const { rows } = await fetchAllPaged(fakeTable(all), { maxRows: 2000 });
    expect(rows.length).toBe(2000);

    const errored: () => Rangeable<{ n: number }> = () => ({
      range: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    });
    const res = await fetchAllPaged(errored);
    expect(res.error).toBe("boom");
  });
});
