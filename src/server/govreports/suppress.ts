// Small-number protection for counts that describe children (people of determination, results). A count between
// 1 and SMALL - 1 could point to a single child, so it is never printed: groups are merged until each holds at
// least SMALL, and a total that is still small is shown as "fewer than 5". Pure and unit-tested.

export const SMALL = 5;

/** A count safe to print: zero or at least `threshold`, otherwise null ("fewer than 5"). */
export function safeCount(n: number, threshold = SMALL): number | null {
  return n === 0 || n >= threshold ? n : null;
}

export type Band<K> = { keys: K[]; n: number | null };

/**
 * Merge ordered groups (for example grades, lowest first) into runs of neighbours so that every run with any
 * count holds at least `threshold`. A small remainder joins the run before it. When even the whole set is small,
 * one run covers every group and its count is null.
 */
export function mergeSmall<K>(cells: Array<{ key: K; n: number }>, threshold = SMALL): Array<Band<K>> {
  const out: Array<{ keys: K[]; n: number }> = [];
  let cur: { keys: K[]; n: number } = { keys: [], n: 0 };
  for (const c of cells) {
    cur.keys.push(c.key);
    cur.n += Math.max(0, Math.trunc(c.n));
    if (cur.n >= threshold) {
      out.push(cur);
      cur = { keys: [], n: 0 };
    }
  }
  if (cur.keys.length) {
    const last = out[out.length - 1];
    if (cur.n === 0) out.push(cur);
    else if (last) {
      last.keys.push(...cur.keys);
      last.n += cur.n;
    } else out.push(cur);
  }
  // Zero runs that sit between counted runs are fine to show; a lone small run is not.
  return out.map((b) => ({ keys: b.keys, n: safeCount(b.n, threshold) }));
}

/** True when no printed figure in the bands is between 1 and threshold - 1. */
export function bandsAreSafe<K>(bands: Array<Band<K>>, threshold = SMALL): boolean {
  return bands.every((b) => b.n === null || b.n === 0 || b.n >= threshold);
}
