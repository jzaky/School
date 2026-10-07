// Sign-up with Google or Microsoft: the school details are kept in a short-lived signed cookie while the person
// signs in with their provider, then /signup/complete creates the school. Signed with AUTH_SECRET (HMAC-SHA256).
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { SignupInput } from "@/lib/signup";

export const PENDING_COOKIE = "pending_signup";
const TTL_MS = 30 * 60_000;

export type PendingSignup = Omit<SignupInput, "password" | "email"> & { exp: number; ref?: string | null };

const secret = () => process.env.AUTH_SECRET ?? "";
const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function sealPending(data: Omit<PendingSignup, "exp">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: now + TTL_MS })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function openPending(value: string | undefined | null, now = Date.now()): PendingSignup | null {
  if (!value || !secret()) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PendingSignup;
    return data.exp > now ? data : null;
  } catch {
    return null;
  }
}

/** The pending sign-up for this browser, if any. Safe to call from Auth.js callbacks. */
export async function pendingSignup(): Promise<PendingSignup | null> {
  try {
    return openPending((await cookies()).get(PENDING_COOKIE)?.value);
  } catch {
    return null;
  }
}
