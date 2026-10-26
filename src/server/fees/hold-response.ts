import "server-only";
// The page a family sees when a report card download is on finance hold (status 423 Locked).
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function financeHoldResponse(locale: "en" | "ar", parent: boolean) {
  const t = await getTranslations({ locale, namespace: "finance.hold" });
  const title = t("title");
  const body = parent ? t("parentBody") : t("studentBody");
  const html = `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2937"><h1 style="font-size:1.25rem;color:#123a63">${esc(title)}</h1><p>${esc(body)}</p><p><a href="/${locale}/${parent ? "fees" : "home"}">${esc(parent ? t("toFees") : t("toHome"))}</a></p></body></html>`;
  return new NextResponse(html, { status: 423, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
