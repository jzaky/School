import { notFound, redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isLocale } from "@/i18n/routing";

// /join/<token> opens the invitation in the visitor's language.
export default async function JoinTokenRedirect({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) notFound();
  const raw = await getLocale();
  redirect(`/${isLocale(raw) ? raw : "en"}/join/${token}`);
}
