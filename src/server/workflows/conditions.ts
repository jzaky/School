import type { WorkflowCondition } from "./graph";

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function isEmpty(v: unknown) {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Evaluate a workflow condition against the run context ({ form, request, student }). */
export function evaluateCondition(cond: WorkflowCondition | undefined, ctx: Record<string, unknown>): boolean {
  if (!cond) return true;
  if ("all" in cond) return cond.all.every((c) => evaluateCondition(c, ctx));
  if ("any" in cond) return cond.any.some((c) => evaluateCondition(c, ctx));
  const v = getPath(ctx, cond.field);
  switch (cond.op) {
    case "eq":
      return v === cond.value || String(v) === String(cond.value);
    case "neq":
      return !(v === cond.value || String(v) === String(cond.value));
    case "in":
      return Array.isArray(cond.value) && cond.value.map(String).includes(String(v));
    case "gt":
      return Number(v) > Number(cond.value);
    case "lt":
      return Number(v) < Number(cond.value);
    case "contains":
      return Array.isArray(v) ? v.map(String).includes(String(cond.value)) : String(v ?? "").includes(String(cond.value));
    case "empty":
      return isEmpty(v);
    case "not_empty":
      return !isEmpty(v);
    default:
      return false;
  }
}
