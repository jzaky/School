/**
 * Builds a request body the route accepts, from the route's own validation errors. The API answers invalid input
 * with each issue's path, kind and limits (app.ts, describeIssues); this fills the body one round at a time until
 * the route stops answering 400, so an attack reaches the handler's lookups and permission checks instead of
 * stopping at input validation. Every id-shaped field gets an id chosen by its name (the caller decides whose).
 */
export interface Issue {
  path: string[];
  code: string;
  expected?: string;
  format?: string;
  origin?: string;
  minimum?: number | string;
  maximum?: number | string;
  keys?: string[];
  values?: unknown[];
}

export type IdFor = (fieldName: string) => string;

type Json = Record<string, unknown> | unknown[];

function setAt(root: Record<string, unknown>, path: string[], value: unknown | ((old: unknown) => unknown)): void {
  let cur: Json = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const nextIsIndex = /^\d+$/.test(path[i + 1]!);
    const holder = cur as Record<string, unknown>;
    if (!holder[key] || typeof holder[key] !== "object") holder[key] = nextIsIndex ? [] : {};
    cur = holder[key] as Json;
  }
  const last = path[path.length - 1]!;
  const holder = cur as Record<string, unknown>;
  holder[last] = typeof value === "function" ? (value as (old: unknown) => unknown)(holder[last]) : value;
}

function deleteAt(root: Record<string, unknown>, path: string[], key: string): void {
  let cur: unknown = root;
  for (const p of path) cur = (cur as Record<string, unknown> | undefined)?.[p];
  if (cur && typeof cur === "object") delete (cur as Record<string, unknown>)[key];
}

const lastName = (path: string[]) => [...path].reverse().find((p) => !/^\d+$/.test(p)) ?? "id";

function valueFor(issue: Issue, idFor: IdFor, old: unknown): unknown {
  const name = lastName(issue.path);
  const n = (v: number | string | undefined, d: number) => (v === undefined ? d : Number(v));
  switch (issue.code) {
    case "invalid_type":
      switch (issue.expected) {
        case "string":
          return /id$|ids?$/i.test(name) ? idFor(name) : `attack ${name} value`;
        case "number":
        case "int":
          return 1;
        case "boolean":
          return true;
        case "array":
          return [];
        case "object":
        case "record":
          return {};
        case "date":
          return new Date().toISOString();
        default:
          return "x";
      }
    case "invalid_format":
      switch (issue.format) {
        case "uuid":
        case "guid":
          return idFor(name);
        case "email":
          return "attack@attack.example";
        case "url":
          return "https://attack.example/x";
        case "datetime":
        case "date":
          return new Date(Date.now() + 3_600_000).toISOString();
        default:
          return "attack-key";
      }
    case "invalid_value":
      return issue.values?.[0] ?? "x";
    case "too_small":
      if (issue.origin === "array" || Array.isArray(old)) return [...((old as unknown[]) ?? []), idFor(name)];
      if (issue.origin === "number" || typeof old === "number") return n(issue.minimum, 1);
      return `${typeof old === "string" ? old : ""}${"a".repeat(n(issue.minimum, 3))}`.slice(0, Math.max(n(issue.minimum, 3), 3) + 20);
    case "too_big":
      if (Array.isArray(old)) return old.slice(0, n(issue.maximum, 1));
      if (typeof old === "number") return n(issue.maximum, 1);
      return typeof old === "string" ? old.slice(0, n(issue.maximum, 1)) : old;
    default:
      return undefined;
  }
}

/** One round: applies every issue to the body. Returns whether anything changed. */
export function applyIssues(body: Record<string, unknown>, issues: Issue[], idFor: IdFor): boolean {
  const before = JSON.stringify(body);
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const k of issue.keys ?? []) deleteAt(body, issue.path, k);
      continue;
    }
    if (!issue.path.length) continue;
    setAt(body, issue.path, (old: unknown) => {
      const v = valueFor(issue, idFor, old);
      return v === undefined ? old : v;
    });
  }
  return JSON.stringify(body) !== before;
}

export function issuesOf(responseBody: string): Issue[] {
  try {
    const j = JSON.parse(responseBody) as { error?: { details?: { issues?: Issue[] } } };
    return j.error?.details?.issues ?? [];
  } catch {
    return [];
  }
}

/** Picks an id from an organization's tables by the field's name: agentId from agents, policyVersionId from policy_versions. */
export function idPicker(byTable: Map<string, string[]>, fallback: string): IdFor {
  const tables = [...byTable.keys()];
  return (field) => {
    const stem = field
      .replace(/Ids?$/, "")
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .toLowerCase();
    const exact = tables.find((t) => t === stem || t === `${stem}s` || t === `${stem}es`);
    const loose = exact ?? tables.find((t) => t.endsWith(`_${stem}s`) || t.startsWith(`${stem}_`) || t.includes(stem));
    return (loose && byTable.get(loose)?.[0]) ?? fallback;
  };
}
