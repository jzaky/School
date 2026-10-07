"use server";

import { cookies } from "next/headers";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { getCtx } from "@/server/context";
import { isLocale } from "@/i18n/routing";
import { DEMO_SLUG, GROUP_PERSONA } from "@/server/demo/constants";

export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return { ok: false };
  (await cookies()).set("NEXT_LOCALE", locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  try {
    const ctx = await getCtx();
    await ctx.db.membership.update({ where: { id: ctx.membershipId }, data: { locale } });
  } catch {
    // Not signed in: the cookie alone is enough.
  }
  return { ok: true };
}

export async function setMarketingLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set("NEXT_LOCALE", locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

export async function signInAsPersonaAction(personaKey: string, locale: string) {
  const loc = isLocale(locale) ? locale : "en";
  try {
    // The school group persona starts on the group dashboard; everyone else on their school home.
    await signIn("persona", { orgSlug: DEMO_SLUG, personaKey, redirectTo: `/${loc}/${personaKey === GROUP_PERSONA ? "group" : "home"}` });
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: "persona" };
    throw e;
  }
  return { ok: true };
}

export async function signInWithPasswordAction(_: unknown, formData: FormData) {
  const loc = String(formData.get("locale") ?? "en");
  try {
    await signIn("password", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: `/${isLocale(loc) ? loc : "en"}/home`,
    });
  } catch (e) {
    if (e instanceof AuthError) return { error: "invalid" as const };
    throw e;
  }
  return { error: null };
}

export async function signInWithProviderAction(provider: "google" | "microsoft-entra-id", locale: string) {
  await signIn(provider, { redirectTo: `/${isLocale(locale) ? locale : "en"}/home` });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
