import type { z } from "zod";

/**
 * Validates a partial update against an input schema and keeps only the fields the caller sent.
 * Zod 4 applies `.default()` values even inside `.partial()`, so parsing a patch with `schema.partial()`
 * alone would silently reset every omitted field to its default. Use this for every edit.
 */
export function parsePatch<S extends z.ZodObject>(schema: S, input: unknown): Partial<z.output<S>> {
  const parsed = schema.partial().parse(input) as Record<string, unknown>;
  const given = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => Object.prototype.hasOwnProperty.call(given, k) && given[k] !== undefined)) as Partial<z.output<S>>;
}
