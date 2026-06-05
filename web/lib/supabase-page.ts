// PostgREST (Supabase's data API) caps every response at a default maximum
// number of rows (1000 on this project) — regardless of the `.limit()` you
// pass. Any dashboard aggregate that reads more than that silently loses rows:
// e.g. the Prod leads phone-set was truncated to 1000 of 7.5k numbers, so most
// real calls failed the Prod filter and "Total appels" collapsed from 415 to
// ~50. This helper pages with `.range()` until a short page comes back, so we
// always read the full set.

// Minimal shape of a Supabase query builder: it's thenable and exposes
// `.range()`. Typing it this loosely avoids importing PostgREST generics while
// still being safe at the call sites.
export type Rangeable<T> = {
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

export async function fetchAllPaged<T>(
  makeQuery: () => Rangeable<T>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: T[]; error: string | null }> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 100000;
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1);
    if (error) return { rows, error: error.message };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break; // last page
  }
  return { rows, error: null };
}
