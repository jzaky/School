"use server";

// Public join actions: accept an invitation, check a school code, join with the code, continue with
// Google or Microsoft. After joining, the person is signed in to that school.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { auth, signIn, signOut, unstable_update } from "@/auth";
import { isLocale } from "@/i18n/routing";
import { JoinUnavailableError } from "@/server/platform/join-lookup";
import { acceptInvite, checkJoinCode, joinWithCode, JoinError, type AccountInput, type JoinResult } from "./join";
import { clientIp } from "./rate-limit";
import { JOIN_INTENT_COOKIE, isJoinPath } from "./sign-in";

type Fail = { ok: false; error: string };

const accountSchema = z.object({
  mode: z.enum(["create", "signin", "session"]),
  name: z.string().max(120).optional(),
  email: z.string().max(254).optional(),
  password: z.string().max(200).optional(),
});

async function ip() {
  return clientIp(await headers());
}

async function accountFrom(raw: z.input<typeof accountSchema>): Promise<AccountInput | null> {
  const d = accountSchema.safeParse(raw);
  if (!d.success) return null;
  if (d.data.mode === "session") {
    const session = await auth();
    return session?.user?.id ? { mode: "session", userId: session.user.id } : null;
  }
  if (d.data.mode === "signin") return { mode: "signin", email: d.data.email ?? "", password: d.data.password ?? "" };
  return { mode: "create", name: d.data.name ?? "", email: d.data.email ?? "", password: d.data.password ?? "" };
}

function errorCode(e: unknown): string | null {
  if (e instanceof JoinError) return e.code;
  if (e instanceof JoinUnavailableError) return "UNAVAILABLE";
  return null;
}

/** Sign the person in to the school they just joined, then send them home (or to the waiting screen). */
async function finish(result: JoinResult, account: AccountInput, password: string | undefined, locale: string): Promise<never> {
  const loc = isLocale(locale) ? locale : "en";
  const to = result.status === "ACTIVE" ? `/${loc}/home` : `/${loc}/join/waiting`;
  if (account.mode === "session") {
    if (result.status === "ACTIVE") await unstable_update({ activeOrgId: result.orgId } as never);
    redirect(to);
  }
  try {
    await signIn("password", { email: result.email, password: password ?? "", redirectTo: to });
  } catch (e) {
    // The account exists and joined; if automatic sign-in fails, the person signs in normally.
    if (e instanceof AuthError) redirect(`/login`);
    throw e;
  }
  redirect(to);
}

export async function acceptInviteAction(input: { token: string; locale: string; account: z.input<typeof accountSchema> }): Promise<Fail> {
  const account = await accountFrom(input.account);
  if (!account) return { ok: false, error: "CREDENTIALS" };
  let result: JoinResult;
  try {
    result = await acceptInvite(String(input.token ?? ""), account, { ip: await ip() });
  } catch (e) {
    const code = errorCode(e);
    if (code) return { ok: false, error: code };
    throw e;
  }
  return finish(result, account, input.account.password, input.locale);
}

export async function checkJoinCodeAction(code: string) {
  try {
    const res = await checkJoinCode(String(code ?? ""), { ip: await ip() });
    if (!res) return { ok: false as const, error: "CODE" };
    const s = res.school;
    return {
      ok: true as const,
      school: { nameEn: s.nameEn, nameAr: s.nameAr, logoUrl: s.logoUrl, primaryColor: s.primaryColor, approval: s.parentJoinApproval },
      options: res.options,
    };
  } catch (e) {
    const c = errorCode(e);
    if (c) return { ok: false as const, error: c };
    throw e;
  }
}

const childSchema = z.object({
  studentNo: z.string().max(40).nullable().optional(),
  dateOfBirth: z.string().max(20).nullable().optional(),
  grade: z.number().int().min(0).max(13).nullable().optional(),
  fullName: z.string().max(120).nullable().optional(),
});

export async function joinWithCodeAction(input: {
  code: string;
  kind: "PARENT" | "STAFF" | "STUDENT";
  locale: string;
  account: z.input<typeof accountSchema>;
  children?: Array<z.input<typeof childSchema>>;
  note?: string;
}): Promise<Fail> {
  const account = await accountFrom(input.account);
  if (!account) return { ok: false, error: "CREDENTIALS" };
  const kind = z.enum(["PARENT", "STAFF", "STUDENT"]).safeParse(input.kind);
  const children = z.array(childSchema).max(9).safeParse(input.children ?? []);
  if (!kind.success || !children.success) return { ok: false, error: "INVALID" };
  let result: JoinResult;
  try {
    result = await joinWithCode({ code: String(input.code ?? ""), kind: kind.data, account, children: children.data, note: input.note ?? null }, { ip: await ip() });
  } catch (e) {
    const code = errorCode(e);
    if (code) return { ok: false, error: code };
    throw e;
  }
  return finish(result, account, input.account.password, input.locale);
}

/** Remember the join page, then continue with Google or Microsoft. The page finishes joining on return. */
export async function continueWithProviderAction(provider: "google" | "microsoft-entra-id", returnPath: string) {
  if (!isJoinPath(returnPath)) return { ok: false as const, error: "INVALID" };
  (await cookies()).set(JOIN_INTENT_COOKIE, returnPath, { path: "/", maxAge: 15 * 60, sameSite: "lax", httpOnly: true });
  await signIn(provider, { redirectTo: returnPath });
  return { ok: true as const };
}

/** "Use a different account" on a join page. */
export async function signOutToJoinAction(returnPath: string) {
  await signOut({ redirectTo: isJoinPath(returnPath) ? returnPath : "/join" });
}
