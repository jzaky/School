// School sign-up rules shared by the form (client) and the server action. Pure: no database access.
import { z } from "zod";

export const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"] as const;
export type Emirate = (typeof EMIRATES)[number];

export const CURRICULA = ["BRITISH", "AMERICAN", "IB", "UAE_MOE", "CBSE", "ISC", "SABIS", "JORDAN_TAWJIHI", "OTHER"] as const;
export type Curriculum = (typeof CURRICULA)[number];

/** The education regulator for a school in each emirate. */
export function regulatorFor(emirate: string): "KHDA" | "ADEK" | "SPEA" | "MOE" {
  if (emirate === "Dubai") return "KHDA";
  if (emirate === "Abu Dhabi") return "ADEK";
  if (emirate === "Sharjah") return "SPEA";
  return "MOE";
}

/** Slugs that would clash with routes or the demo school. */
export const RESERVED_SLUGS = new Set(["horizon", "demo", "admin", "api", "app", "www", "login", "signup", "setup", "en", "ar", "platform", "support", "help", "static", "public"]);

/** URL-safe slug from a school name: lowercase latin letters, digits and hyphens, at most 40 characters. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (!base || base.length < 3) return base ? `school-${base}` : "school";
  return RESERVED_SLUGS.has(base) ? `${base}-school` : base;
}

/** Candidate slugs in order: the base, then numbered variants. The caller picks the first free one. */
export function slugCandidates(name: string, count = 20): string[] {
  const base = slugify(name);
  const out = [base];
  for (let i = 2; out.length < count; i++) out.push(`${base.slice(0, 36)}-${i}`);
  return out;
}

/** Join codes avoid characters that are easy to confuse (0 and O, 1 and I). */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function joinCodeFrom(bytes: Uint8Array, length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) out += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  return out;
}

const COMMON = ["password", "123456", "qwerty", "letmein", "welcome", "iloveyou", "abc123", "111111", "123123"];

export type PasswordIssue = "short" | "letter" | "digit" | "common" | "email";

/** Why a password is too weak, or an empty list when it is acceptable. */
export function passwordIssues(password: string, email = ""): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < 10) issues.push("short");
  if (!/[A-Za-z؀-ۿ]/.test(password)) issues.push("letter");
  if (!/\d/.test(password)) issues.push("digit");
  const lower = password.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) issues.push("common");
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && lower.includes(local)) issues.push("email");
  return issues;
}

/** 0 (weak) to 3 (strong), for the meter under the password field. */
export function passwordScore(password: string, email = ""): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  if (passwordIssues(password, email).length) return password.length >= 8 ? 1 : 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  return password.length >= 14 || classes >= 4 ? 3 : 2;
}

const name = z.string().trim().min(3).max(120);

export const signupSchema = z.object({
  schoolNameEn: name,
  schoolNameAr: name,
  emirate: z.enum(EMIRATES),
  curricula: z.array(z.enum(CURRICULA)).min(1).max(CURRICULA.length),
  adminName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().max(200),
  isPrincipal: z.boolean(),
  locale: z.enum(["en", "ar"]),
});

export type SignupInput = z.infer<typeof signupSchema>;

export type SignupFieldError = "schoolNameEn" | "schoolNameAr" | "emirate" | "curricula" | "adminName" | "email" | "password";

/** Parse the sign-up form. For OAuth sign-up the password is not needed. */
export function parseSignup(raw: Record<string, unknown>, opts: { needPassword: boolean }): { ok: true; data: SignupInput } | { ok: false; field: SignupFieldError; issues?: PasswordIssue[] } {
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    const field = (parsed.error.issues[0]?.path[0] as SignupFieldError) ?? "schoolNameEn";
    return { ok: false, field };
  }
  if (opts.needPassword) {
    const issues = passwordIssues(parsed.data.password, parsed.data.email);
    if (issues.length) return { ok: false, field: "password", issues };
  }
  return { ok: true, data: parsed.data };
}

/** Sign-up is on unless SIGNUP_ENABLED is set to "false". */
export const signupEnabled = () => process.env.SIGNUP_ENABLED !== "false";
