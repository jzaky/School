// The application form: steps and their validation. Pure (zod), shared by the wizard and the server actions.
// The server always validates again; nothing the browser sends is trusted.
import { z } from "zod";
import { ALL_GRADE_LEVELS } from "@/lib/grade-levels";
import { RELATIONSHIPS } from "./config";
import { eidDigits } from "./rules";

export const STEPS = ["student", "schooling", "family", "health", "documents", "review"] as const;
export type Step = (typeof STEPS)[number];

const name = z.string().trim().min(1).max(60);
const optName = z.string().trim().max(60).optional().default("");
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optText = (max: number) => z.string().trim().max(max).optional().default("");
const country = z.string().regex(/^[A-Z]{2}$/);
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/);
const email = z.string().trim().toLowerCase().email().max(254);

export const studentSchema = z.object({
  academicYearId: z.string().min(5).max(40),
  gradeLevel: z.number().int().refine((g) => ALL_GRADE_LEVELS.includes(g)),
  /** The track the child joins when the school teaches more than one (one of the school's curricula). */
  curriculum: z.enum(["BRITISH", "IB", "AMERICAN", "UAE_MOE", "JORDAN_TAWJIHI", "CBSE", "ISC", "SABIS", "OTHER"]).nullable().optional().default(null),
  firstNameEn: name,
  lastNameEn: name,
  firstNameAr: optName,
  lastNameAr: optName,
  dateOfBirth: dateKey,
  gender: z.enum(["F", "M"]),
  nationality: country,
  homeLanguage: optText(10),
  emiratesId: z
    .string()
    .trim()
    .max(25)
    .optional()
    .default("")
    .refine((v) => !v || eidDigits(v) !== null, { message: "EID" }),
  passport: z
    .string()
    .trim()
    .max(20)
    .optional()
    .default("")
    .refine((v) => !v || /^[A-Za-z0-9]{5,15}$/.test(v), { message: "PASSPORT" }),
});
export type StudentStep = z.infer<typeof studentSchema>;

export const schoolingSchema = z.discriminatedUnion("attended", [
  z.object({ attended: z.literal(false) }),
  z.object({
    attended: z.literal(true),
    schoolName: z.string().trim().min(2).max(120),
    city: optText(60),
    country: country,
    curriculum: optText(60),
    lastGrade: optText(30),
    fromYear: z.number().int().min(2000).max(2100).nullable().optional().default(null),
    toYear: z.number().int().min(2000).max(2100).nullable().optional().default(null),
    leavingReason: optText(300),
  }),
]);
export type SchoolingStep = z.infer<typeof schoolingSchema>;

export const guardianSchema = z.object({
  relationship: z.enum(RELATIONSHIPS),
  firstNameEn: name,
  lastNameEn: name,
  firstNameAr: optName,
  lastNameAr: optName,
  email,
  phone,
  occupation: optText(80),
  employer: optText(80),
  livesWith: z.boolean().default(true),
  primary: z.boolean().default(false),
});
export type GuardianInput = z.infer<typeof guardianSchema>;

export const siblingSchema = z.object({
  name: z.string().trim().min(2).max(120),
  gradeLevel: z.number().int().refine((g) => ALL_GRADE_LEVELS.includes(g)).nullable().optional().default(null),
  studentNo: optText(30),
});

export const familySchema = z
  .object({
    guardians: z.array(guardianSchema).min(1).max(4),
    siblings: z.array(siblingSchema).max(6).default([]),
    staffChild: z.boolean().default(false),
  })
  .transform((v) => {
    // Exactly one primary contact: the first one marked, or the first guardian.
    const i = Math.max(0, v.guardians.findIndex((g) => g.primary));
    return { ...v, guardians: v.guardians.map((g, j) => ({ ...g, primary: j === i })) };
  });
export type FamilyStep = z.infer<typeof familySchema>;

export const healthSchema = z.object({
  allergies: optText(1000),
  conditions: optText(1000),
  medications: optText(1000),
  supportNeeded: z.boolean().default(false),
  supportDetails: optText(2000),
  previousAssessment: z.boolean().default(false),
});
export type HealthStep = z.infer<typeof healthSchema>;

export const reviewSchema = z.object({ consent: z.literal(true) });

export const STEP_SCHEMAS = {
  student: studentSchema,
  schooling: schoolingSchema,
  family: familySchema,
  health: healthSchema,
} as const;

/** Has any health information been given? (Drives the "health information provided" flag staff see.) */
export function hasMedicalInfo(h: Pick<HealthStep, "allergies" | "conditions" | "medications">) {
  return Boolean(h.allergies || h.conditions || h.medications);
}
