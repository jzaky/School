"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { rawPrisma } from "@aegis/db";
import type { ActionResult } from "@/lib/action-result";
import { DEPLOYMENTS, INTERESTS } from "@/components/marketing/form-options";

/**
 * Public-site forms. The only persistence is a platform_events row; a person follows up by
 * email. No tenant data is involved, so the global connection is appropriate here.
 */

const RATE_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return false;
}


const base = {
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid work email").max(254),
  organization: z.string().trim().min(2, "Enter your organization").max(160),
  role: z.string().trim().min(2, "Enter your role").max(120),
  interest: z.enum(INTERESTS, { errorMap: () => ({ message: "Choose an area of interest" }) }),
  message: z.string().trim().max(4000).default(""),
  // Honeypot. Humans never see this field; bots fill it.
  website: z.string().max(200).default(""),
  path: z.string().max(200).default(""),
};

const inquirySchema = z.object({ ...base, kind: z.literal("inquiry") });
const demoSchema = z.object({
  ...base,
  kind: z.literal("demo_request"),
  preferredDates: z.string().trim().min(2, "Suggest one or two dates or a week").max(300),
  deploymentPreference: z.enum(DEPLOYMENTS, { errorMap: () => ({ message: "Choose a deployment preference" }) }),
});
const schema = z.discriminatedUnion("kind", [inquirySchema, demoSchema]);

export type MarketingSubmission = z.input<typeof schema>;
export type MarketingResult = ActionResult<{ reference: string; kind: "inquiry" | "demo_request" }>;

function fieldErrors(e: z.ZodError): string {
  return e.issues.map((i) => i.message).join(". ");
}

export async function submitMarketingForm(input: unknown): Promise<MarketingResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: fieldErrors(parsed.error) };
  const data = parsed.data;

  // Honeypot filled: pretend success, store nothing.
  if (data.website.length > 0) return { ok: true, data: { reference: "received", kind: data.kind } };

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (rateLimited(ip)) return { ok: false, error: "Too many submissions from this network in the last hour. Please try again later or email us directly." };

  const detail: Record<string, unknown> = {
    source: "public_site",
    path: data.path,
    name: data.name,
    email: data.email,
    organization: data.organization,
    role: data.role,
    interest: data.interest,
    message: data.message,
  };
  if (data.kind === "demo_request") {
    detail.preferredDates = data.preferredDates;
    detail.deploymentPreference = data.deploymentPreference;
  }
  try {
    const row = await rawPrisma().platformEvent.create({ data: { type: data.kind === "inquiry" ? "marketing.inquiry" : "marketing.demo_request", detail }, select: { id: true } });
    return { ok: true, data: { reference: row.id.slice(0, 8).toUpperCase(), kind: data.kind } };
  } catch (e) {
    // Log the error class only; the payload holds contact details.
    console.error("[marketing] inquiry persistence failed", e instanceof Error ? e.name : typeof e);
    return { ok: false, error: "We could not record your request right now. Please try again in a few minutes." };
  }
}
