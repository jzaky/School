// Server-side paging for long lists. Counts always come from a count query on the same filter, never from the
// number of rows loaded, so "Showing 1 to 50 of 1,554" is the real total.

export const PAGE_SIZE = 50;

export type PageWindow = { page: number; pages: number; skip: number; take: number; from: number; to: number; total: number };

/** The page asked for in the URL (1-based), clamped to the pages that exist. */
export function pageWindow(raw: string | string[] | undefined | null, total: number, size = PAGE_SIZE): PageWindow {
  const pages = Math.max(1, Math.ceil(total / size));
  const asked = Number(Array.isArray(raw) ? raw[0] : raw);
  const page = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, pages) : 1;
  const skip = (page - 1) * size;
  return { page, pages, skip, take: size, from: total === 0 ? 0 : skip + 1, to: Math.min(total, skip + size), total };
}

/** A search box value: trimmed, single spaces, bounded length. */
export const searchTerm = (q: string | undefined | null, max = 80) => (q ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** A page link that keeps the other query parameters (page 1 has no page parameter). */
export function pageHref(path: string, params: Record<string, string | undefined>, page: number) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
