import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isLocale } from "@/i18n/routing";

// Short public address a school shares on its website: /apply/<school> opens the application page in the visitor's language.
export default async function ApplyRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "en";
  const clean = (slug ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  redirect(`/${locale}/apply/${clean}`);
}
