import { currentRegion, intlLocale, type Region } from "./region";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Date and time in the organization's time zone and the viewer's console language. */
export function formatDateTime(d: Date | string | null | undefined, region: Region = currentRegion()): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString(intlLocale(region.locale), { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: region.timeZone });
}

/** A calendar date in UTC, for dates without a meaningful time of day (effective dates, due dates). */
export function formatDate(d: Date | string | null | undefined, region: Region = currentRegion()): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(intlLocale(region.locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatMoney(amount: number, currency = "AED"): string {
  return new Intl.NumberFormat("en-AE", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
