// Marketing lead validation shared by the public forms and the server actions. Pure: no database access.
import { z } from "zod";

/** Bump when the consent wording on /try or /pricing changes, so each lead records what was agreed. */
export const CONSENT_VERSION = "2026-10-v1";

export const LEAD_ROLES = ["STUDENT", "PARENT", "STAFF"] as const;
export type LeadRole = (typeof LEAD_ROLES)[number];

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(LEAD_ROLES),
  schoolName: z
    .string()
    .trim()
    .max(160)
    .transform((s) => (s ? s : null)),
  consent: z.literal(true),
  locale: z.enum(["en", "ar"]),
});

export type LeadContact = z.infer<typeof contactSchema>;
export type LeadField = "name" | "email" | "role" | "schoolName" | "consent";

export type ParsedContact = { ok: true; data: LeadContact } | { ok: false; field: LeadField };

/** Parse the contact part of a lead form. An offer request also needs the school name. */
export function parseLeadContact(raw: Record<string, unknown>, opts: { requireSchool?: boolean } = {}): ParsedContact {
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { ok: false, field: (["name", "email", "role", "schoolName", "consent"].includes(String(field)) ? field : "name") as LeadField };
  }
  if (opts.requireSchool && !(parsed.data.schoolName && parsed.data.schoolName.length >= 2)) return { ok: false, field: "schoolName" };
  return { ok: true, data: parsed.data };
}

/** Read the contact fields from a submitted form. */
export function contactFromForm(fd: FormData): Record<string, unknown> {
  const locale = String(fd.get("locale") ?? "en");
  return {
    name: String(fd.get("name") ?? ""),
    email: String(fd.get("email") ?? ""),
    role: String(fd.get("role") ?? ""),
    schoolName: String(fd.get("schoolName") ?? ""),
    consent: fd.get("consent") === "on" || fd.get("consent") === "true",
    locale: locale === "ar" ? "ar" : "en",
  };
}

/** A CSV cell: quoted, with formula-looking values neutralized so spreadsheets do not run them. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
