"use server";
import { cookies } from "next/headers";
import { z } from "zod";
import { LOCALE_COOKIE } from "@/lib/region";
import { act } from "./util";

/** The viewer's console language, kept in a cookie for this browser. It changes presentation only. */
export async function setLocaleAction(locale: unknown) {
  return act(async () => {
    const value = z.enum(["en", "ar"]).parse(locale);
    (await cookies()).set(LOCALE_COOKIE, value, { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  });
}
