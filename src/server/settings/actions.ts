"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { LOCKED_KINDS } from "./kinds";
import { setChannelPreference } from "@/server/notify/devices";

const YEAR = 60 * 60 * 24 * 365;

/** Display preferences live in cookies so they apply before the page renders. */
export async function setDisplayAction(input: { hijri?: boolean; numerals?: "WESTERN" | "ARABIC_INDIC" }) {
  const ctx = await getCtx();
  const jar = await cookies();
  if (input.hijri !== undefined) jar.set("hijri", input.hijri && ctx.org.hijriEnabled ? "1" : "0", { path: "/", maxAge: YEAR, sameSite: "lax" });
  if (input.numerals === "WESTERN" || input.numerals === "ARABIC_INDIC") jar.set("numerals", input.numerals, { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Email on or off for one kind of notification. In-app notifications always stay on. */
export async function setEmailPreferenceAction(input: { kind: string; email: boolean }) {
  const ctx = await getCtx();
  if (LOCKED_KINDS.includes(input.kind)) return { ok: false as const, error: "LOCKED" };
  if (!/^[a-z_]{3,40}$/.test(input.kind)) return { ok: false as const, error: "BAD_KIND" };
  // Other channels (push, WhatsApp) keep their own setting.
  await setChannelPreference(ctx.db, ctx.orgId, ctx.membershipId, input.kind, "EMAIL", input.email);
  return { ok: true as const };
}
