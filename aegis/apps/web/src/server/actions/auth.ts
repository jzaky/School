"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAegisError, isProduction, loginSchema, loginWithPassword, markMfaPassed, revokeSession, SESSION_COOKIE, setSessionOrg, verifyMfaCode, listUserMemberships } from "@aegis/core";
import { getSession } from "@/server/session";

export interface ActionState {
  error?: string;
}

const cookieOpts = { httpOnly: true, secure: isProduction(), sameSite: "lax" as const, path: "/" };

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password" };
  const h = await headers();
  try {
    const r = await loginWithPassword(parsed.data, { ip: h.get("x-forwarded-for") ?? undefined, userAgent: h.get("user-agent") ?? undefined });
    (await cookies()).set(SESSION_COOKIE, r.token, cookieOpts);
    redirect(r.mfaRequired ? "/mfa" : "/overview");
  } catch (e) {
    if (isRedirect(e)) throw e;
    return { error: isAegisError(e) ? e.message : "Sign in failed" };
  }
}

export async function mfaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const s = await getSession();
  if (!s) redirect("/login");
  const code = String(formData.get("code") ?? "");
  if (!(await verifyMfaCode(s.user.id, code))) return { error: "Invalid code" };
  await markMfaPassed(s.id);
  redirect("/overview");
}

export async function logoutAction(): Promise<void> {
  const s = await getSession();
  if (s) await revokeSession(s.id);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function switchOrgAction(orgId: string): Promise<void> {
  const s = await getSession();
  if (!s) redirect("/login");
  const memberships = await listUserMemberships(s.user.id);
  if (!memberships.some((m) => m.orgId === orgId && m.status === "active")) return;
  await setSessionOrg(s.id, orgId);
  redirect("/overview");
}

function isRedirect(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}
