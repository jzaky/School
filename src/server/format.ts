import "server-only";
import { cookies } from "next/headers";
import type { Ctx } from "@/server/context";
import type { FormatPrefs } from "@/lib/format";

/** Formatting preferences: org numerals, plus a per-user Hijri display preference cookie. */
export async function formatPrefs(ctx: Ctx): Promise<FormatPrefs> {
  const jar = await cookies();
  const hijri = jar.get("hijri")?.value === "1" && ctx.org.hijriEnabled;
  const numerals = (jar.get("numerals")?.value as FormatPrefs["numerals"]) ?? ctx.org.numerals;
  return { locale: ctx.locale, numerals, hijri };
}
