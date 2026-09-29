"use server";

import { cookies, headers } from "next/headers";
import { AuthError } from "next-auth";
import { enabledOAuthProviders, signIn } from "@/auth";
import { identityDb } from "@/lib/tenant-db";
import { isLocale } from "@/i18n/routing";
import { parseSignup, signupEnabled, type PasswordIssue, type SignupFieldError, type SignupInput } from "@/lib/signup";
import { rateLimit } from "@/server/platform/rate-limit";
import { provisionSchool, removeOrphanUser, resolvePasswordUser, SignupError } from "@/server/platform/signup";
import { sendVerificationEmail } from "@/server/onboarding/verification";
import { getCtx } from "@/server/context";
import { audit } from "@/server/audit/audit";
import { PENDING_COOKIE, sealPending } from "@/server/onboarding/oauth-signup";

export type SignupState = {
  error: null | "disabled" | "rate" | "invalid" | "credentials" | "failed";
  field?: SignupFieldError;
  issues?: PasswordIssue[];
};

const HOUR = 3600_000;

function clientIp(h: Headers) {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

function formToRaw(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  return {
    schoolNameEn: String(formData.get("schoolNameEn") ?? ""),
    schoolNameAr: String(formData.get("schoolNameAr") ?? ""),
    emirate: String(formData.get("emirate") ?? ""),
    curricula: formData.getAll("curricula").map(String),
    adminName: String(formData.get("adminName") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    isPrincipal: formData.get("isPrincipal") === "on",
    locale: isLocale(locale) ? locale : "en",
  };
}

/** Rate limits and bot checks every sign-up path shares. Returns an error state, or null to go on. */
async function guard(formData: FormData, email: string | null): Promise<SignupState | null> {
  if (!signupEnabled()) return { error: "disabled" };
  // Honeypot: people never see this field, simple bots fill it in.
  if (String(formData.get("website") ?? "").trim()) return { error: "invalid" };
  const ip = clientIp(await headers());
  if (!(await rateLimit(`signup:ip:${ip}`, 8, HOUR)).ok) return { error: "rate" };
  if (email && !(await rateLimit(`signup:email:${email.toLowerCase()}`, 4, HOUR)).ok) return { error: "rate" };
  return null;
}

async function afterProvision(input: SignupInput, userId: string, orgId: string, membershipId: string) {
  const user = await identityDb.user.findUnique({ where: { id: userId }, select: { emailVerified: true } });
  if (!user?.emailVerified) {
    await sendVerificationEmail({ orgId, membershipId, userId, name: input.adminName, school: { en: input.schoolNameEn, ar: input.schoolNameAr } }).catch(() => {
      // The banner in the app offers "Resend", so a failed first send is recoverable.
      console.error("[signup] verification email could not be queued");
    });
  }
}

/** Public sign-up with email and password. Creates the school and signs the person in to the setup wizard. */
export async function signUpAction(_: SignupState, formData: FormData): Promise<SignupState> {
  const raw = formToRaw(formData);
  const parsed = parseSignup(raw, { needPassword: true });
  const blocked = await guard(formData, parsed.ok ? parsed.data.email : null);
  if (blocked) return blocked;
  if (!parsed.ok) return { error: "invalid", field: parsed.field, issues: parsed.issues };
  const input = parsed.data;

  let user: { userId: string; created: boolean };
  try {
    user = await resolvePasswordUser({ email: input.email, password: input.password, name: input.adminName, locale: input.locale });
  } catch (e) {
    return { error: e instanceof SignupError && e.code === "credentials" ? "credentials" : "failed" };
  }
  let orgId: string;
  let membershipId: string;
  try {
    ({ orgId, membershipId } = await provisionSchool({ userId: user.userId, schoolNameEn: input.schoolNameEn, schoolNameAr: input.schoolNameAr, emirate: input.emirate, curricula: input.curricula, locale: input.locale, isPrincipal: input.isPrincipal }));
  } catch {
    if (user.created) await removeOrphanUser(user.userId).catch(() => undefined);
    return { error: "failed" };
  }
  await afterProvision(input, user.userId, orgId, membershipId);
  (await cookies()).set("NEXT_LOCALE", input.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  try {
    await signIn("password", { email: input.email, password: input.password, redirectTo: `/${input.locale}/setup` });
  } catch (e) {
    if (e instanceof AuthError) return { error: "failed" };
    throw e;
  }
  return { error: null };
}

/** Sign-up with Google or Microsoft: keep the school details in a signed cookie, then send the person to their provider. */
export async function startOAuthSignupAction(_: SignupState, formData: FormData): Promise<SignupState> {
  const provider = formData.get("provider") === "microsoft-entra-id" ? "microsoft-entra-id" : "google";
  const enabled = enabledOAuthProviders();
  if ((provider === "google" && !enabled.google) || (provider === "microsoft-entra-id" && !enabled.microsoft)) return { error: "invalid" };
  const raw = formToRaw(formData);
  const parsed = parseSignup({ ...raw, email: "oauth@signup.invalid" }, { needPassword: false });
  const blocked = await guard(formData, null);
  if (blocked) return blocked;
  if (!parsed.ok) return { error: "invalid", field: parsed.field };
  const { password: _p, email: _e, ...rest } = parsed.data;
  void _p;
  void _e;
  (await cookies()).set(PENDING_COOKIE, sealPending(rest), { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 30 * 60 });
  await signIn(provider, { redirectTo: "/signup/complete" });
  return { error: null };
}

/** Send a new verification link to the school's founding administrator. */
export async function resendVerificationAction(): Promise<{ ok: boolean; error?: "rate" | "forbidden" | "verified" }> {
  const ctx = await getCtx();
  if (ctx.org.createdById !== ctx.user.id) return { ok: false, error: "forbidden" };
  if (ctx.user.emailVerified) return { ok: false, error: "verified" };
  if (!(await rateLimit(`verify:resend:${ctx.user.id}`, 3, HOUR)).ok) return { ok: false, error: "rate" };
  await sendVerificationEmail({ orgId: ctx.orgId, membershipId: ctx.membershipId, userId: ctx.user.id, name: ctx.user.nameEn, school: { en: ctx.org.nameEn, ar: ctx.org.nameAr } });
  await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "org.verification_sent", entityType: "Organization", entityId: ctx.orgId });
  return { ok: true };
}
