import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isLocale } from "@/i18n/routing";

// Short public address for posters and QR codes: /join?code=... opens the join page in the visitor's language.
export default async function JoinRedirect({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "en";
  const clean = (code ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 20);
  redirect(`/${locale}/join${clean ? `?code=${clean}` : ""}`);
}
