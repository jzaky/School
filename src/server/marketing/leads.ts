// Marketing leads from the public site (career taster on /try, offer requests on /pricing).
// Platform data, not school data: rows live in MarketingLead, reachable only through the owner client.
// A lead holds what the visitor typed, their consent time and wording version, and the page it came from.
// No "server-only" marker: the worker imports the email delivery.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MarketingLead, PrismaClient } from "@prisma/client";
import { CONSENT_VERSION, type LeadContact } from "@/lib/leads";
import type { OfferInputs } from "@/lib/roi";
import { scoreTaster, type TasterAnswers, type TasterResult } from "./taster";

type Db = Pick<PrismaClient, "marketingLead">;

// ---------------------------------------------------------------------------
// Private result links: /try/result/<leadId>.<signature>. Nothing extra is stored, so the sweeper can
// rebuild the link for a delayed email. Rotating AUTH_SECRET retires old links.
// ---------------------------------------------------------------------------

const secret = () => process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
const sign = (leadId: string) => createHmac("sha256", secret()).update(`lead-result:${leadId}`).digest("base64url").slice(0, 32);

export function resultToken(leadId: string): string {
  if (!secret()) throw new Error("AUTH_SECRET is required for result links");
  return `${leadId}.${sign(leadId)}`;
}

/** The lead id a result token points to, or null when the token is malformed or forged. */
export function leadIdFromToken(token: string): string | null {
  if (!secret() || !token || token.length > 120) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[a-z0-9]{10,40}$/i.test(id)) return null;
  const a = Buffer.from(sign(id));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type TasterPayload = { answers: TasterAnswers; scores: TasterResult["scores"]; top: Array<{ key: string; matchScore: number }> };

const contactData = (c: LeadContact, now: Date) => ({
  name: c.name,
  email: c.email,
  role: c.role,
  schoolName: c.schoolName,
  locale: c.locale,
  consentAt: now,
  consentVersion: CONSENT_VERSION,
});

export async function createTasterLead(db: Db, input: { contact: LeadContact; answers: TasterAnswers; now?: Date }) {
  const now = input.now ?? new Date();
  const result = scoreTaster(input.answers);
  const payload: TasterPayload = { answers: input.answers, scores: result.scores, top: result.areas.slice(0, 3).map((a) => ({ key: a.key, matchScore: a.matchScore })) };
  const lead = await db.marketingLead.create({ data: { type: "TASTER", source: "try", ...contactData(input.contact, now), payload, createdAt: now } });
  return { lead, token: resultToken(lead.id), result };
}

export async function createOfferLead(db: Db, input: { contact: LeadContact; inputs: OfferInputs; now?: Date }) {
  const now = input.now ?? new Date();
  const lead = await db.marketingLead.create({ data: { type: "OFFER", source: "pricing", ...contactData(input.contact, now), payload: input.inputs, createdAt: now } });
  return { lead };
}

/** The taster lead behind a result token, with its full result recomputed from the stored answers. */
export async function tasterByToken(db: Db, token: string) {
  const id = leadIdFromToken(token);
  if (!id) return null;
  const lead = await db.marketingLead.findUnique({ where: { id } });
  if (!lead || lead.type !== "TASTER") return null;
  const answers = (lead.payload as TasterPayload).answers;
  return { lead, result: scoreTaster(answers) };
}

// ---------------------------------------------------------------------------
// Listing and export (platform admin)
// ---------------------------------------------------------------------------

export type LeadFilter = { type?: "TASTER" | "OFFER" | null; take?: number };

export function listLeads(db: Db, f: LeadFilter = {}) {
  return db.marketingLead.findMany({ where: f.type ? { type: f.type } : {}, orderBy: { createdAt: "desc" }, take: f.take ?? 500 });
}

/** A short, language-neutral summary of what the lead asked about. */
export function leadSummary(lead: Pick<MarketingLead, "type" | "payload">): string {
  if (lead.type === "TASTER") {
    const p = lead.payload as TasterPayload;
    return (p.top ?? []).map((t) => `${t.key} ${t.matchScore}%`).join("; ");
  }
  const p = lead.payload as OfferInputs;
  return `students=${p.students}; campuses=${p.campuses}; modules=${(p.modules ?? []).join("+")}; plan=${p.plan}`;
}

export const LEAD_CSV_HEADER = ["created_at", "type", "source", "name", "email", "role", "school_name", "language", "consent_at", "consent_version", "email_status", "summary", "marketing_lead"];

export function leadCsvRow(l: MarketingLead): unknown[] {
  return [l.createdAt.toISOString(), l.type, l.source, l.name, l.email, l.role, l.schoolName ?? "", l.locale, l.consentAt.toISOString(), l.consentVersion, l.emailStatus, leadSummary(l), "yes"];
}
