import type { RestrictSpec } from "../policy/schema.js";

/**
 * Applies the narrowing of every matched "restrict" rule to the request parameters. Deterministic:
 * caps take the smallest cap, forced values are applied in rule order, removals win over both. The
 * returned `applied` list is recorded in evidence and returned to the agent so the narrowing is
 * never silent.
 */
export function applyRestrictions(params: Record<string, unknown>, specs: RestrictSpec[]): { params: Record<string, unknown>; applied: string[] } {
  const out: Record<string, unknown> = structuredClone(params);
  const applied: string[] = [];
  const caps = new Map<string, number>();
  for (const s of specs) for (const [k, v] of Object.entries(s.capNumeric)) caps.set(k, Math.min(v, caps.get(k) ?? v));
  for (const [path, cap] of caps) {
    const current = getPath(out, path);
    const n = typeof current === "number" ? current : typeof current === "string" && current.trim() !== "" && Number.isFinite(Number(current)) ? Number(current) : null;
    if (n !== null && n > cap) {
      setPath(out, path, cap);
      applied.push(`${path} capped from ${n} to ${cap}`);
    }
  }
  for (const s of specs) {
    for (const [path, v] of Object.entries(s.setParams)) {
      if (JSON.stringify(getPath(out, path)) === JSON.stringify(v)) continue;
      setPath(out, path, v);
      applied.push(`${path} set to ${JSON.stringify(v)}`);
    }
  }
  for (const s of specs) {
    for (const path of s.removeParams) {
      if (getPath(out, path) === undefined) continue;
      deletePath(out, path);
      applied.push(`${path} removed`);
    }
  }
  return { params: out, applied };
}

function segments(path: string): string[] {
  return path.split(".").filter(Boolean);
}
function getPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj;
  for (const s of segments(path)) {
    if (!cur || typeof cur !== "object" || s === "__proto__" || s === "constructor" || s === "prototype") return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}
function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const segs = segments(path);
  if (segs.some((s) => s === "__proto__" || s === "constructor" || s === "prototype")) return;
  let cur = obj;
  for (const s of segs.slice(0, -1)) {
    if (!cur[s] || typeof cur[s] !== "object") cur[s] = {};
    cur = cur[s] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
}
function deletePath(obj: Record<string, unknown>, path: string) {
  const segs = segments(path);
  if (segs.some((s) => s === "__proto__" || s === "constructor" || s === "prototype")) return;
  let cur: Record<string, unknown> = obj;
  for (const s of segs.slice(0, -1)) {
    if (!cur[s] || typeof cur[s] !== "object") return;
    cur = cur[s] as Record<string, unknown>;
  }
  delete cur[segs[segs.length - 1]!];
}
