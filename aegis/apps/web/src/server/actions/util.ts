import { isAegisError } from "@aegis/core";
import { ZodError } from "zod";
import type { ActionResult } from "@/lib/action-result";

export function isNextRedirect(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

/** Runs a server action body and converts known failures into a result the UI can show. */
export async function act<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    if (isAegisError(e)) return { ok: false, error: e.message };
    // "Record to update not found": an id this organization cannot see. Not found, never a server error.
    if (e instanceof Error && e.name === "PrismaClientKnownRequestError" && (e as { code?: string }).code === "P2025") return { ok: false, error: "Not found in this organization" };
    if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    // Log the error class only. Never log request payloads, which may contain personal data.
    console.error("[action] unexpected failure", e instanceof Error ? `${e.name}: ${e.message}` : typeof e);
    return { ok: false, error: "Something went wrong. Try again or contact your administrator." };
  }
}

