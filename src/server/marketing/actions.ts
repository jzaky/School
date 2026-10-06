"use server";

// Public marketing actions: career taster and offer requests. No sign-in.
// Bot and abuse protection like /signup: a honeypot field and per-IP and per-email rate limits.
// Leads are platform data written through the owner client; nothing here touches school data.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { contactFromForm, parseLeadContact, type LeadField } from "@/lib/leads";
import { parseOfferInputs } from "@/lib/roi";
import { rateLimit } from "@/server/platform/rate-limit";
import { catalogDb } from "@/server/platform/catalog-db";
import { queue } from "@/server/queue-core";
import { cleanAnswers, scoreTaster, teaser, type Teaser } from "./taster";
import { createOfferLead, createTasterLead } from "./leads";
import { deliverLeadEmail, LEAD_EMAIL_JOB } from "./lead-email";

const HOUR = 3600_000;

function clientIp(h: Headers) {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

export type LeadState = { error: null | "rate" | "invalid" | "failed" | "answers"; field?: LeadField; ok?: boolean };

/** Shared guard for lead forms. Returns an error state, or null to go on. */
async function guard(fd: FormData, email: string | null, kind: string): Promise<LeadState | null> {
  // Honeypot: people never see this field, simple bots fill it in. Answer as if it worked.
  if (String(fd.get("website") ?? "").trim()) return { error: null, ok: true };
  const ip = clientIp(await headers());
  if (!(await rateLimit(`lead:${kind}:ip:${ip}`, 6, HOUR)).ok) return { error: "rate" };
  if (email && !(await rateLimit(`lead:${kind}:email:${email}`, 3, HOUR)).ok) return { error: "rate" };
  return null;
}

/** Send the lead's email through the worker, or right away when no queue is configured. */
async function sendLeadEmail(leadId: string) {
  const q = queue("notify");
  const db = catalogDb();
  try {
    if (q) {
      await q.add(LEAD_EMAIL_JOB, { leadId }, { jobId: `${LEAD_EMAIL_JOB}:${leadId}` });
      return;
    }
  } catch {
    // Queue not reachable right now: send from here instead (the claim keeps it to one send).
  }
  try {
    if (db) await deliverLeadEmail(db, leadId);
  } catch {
    // The row stays QUEUED and the worker sweeper sends it later.
    console.error("[marketing] lead email could not be sent");
  }
}

/** Score the taster and return the teaser (top three areas). Nothing is stored. */
export async function tasterTeaserAction(rawAnswers: Record<string, number>, locale: "en" | "ar"): Promise<{ ok: true; teaser: Teaser } | { ok: false; error: "rate" | "answers" }> {
  const ip = clientIp(await headers());
  if (!(await rateLimit(`taster:score:${ip}`, 60, HOUR)).ok) return { ok: false, error: "rate" };
  const answers = cleanAnswers(rawAnswers);
  if (!answers) return { ok: false, error: "answers" };
  return { ok: true, teaser: teaser(scoreTaster(answers), locale === "ar" ? "ar" : "en") };
}

/** Unlock the full taster result: creates a TASTER lead, emails the result and opens the private result page. */
export async function submitTasterLeadAction(_: LeadState, fd: FormData): Promise<LeadState> {
  const parsed = parseLeadContact(contactFromForm(fd));
  const blocked = await guard(fd, parsed.ok ? parsed.data.email : null, "taster");
  if (blocked) return blocked;
  if (!parsed.ok) return { error: "invalid", field: parsed.field };
  let answers: ReturnType<typeof cleanAnswers> = null;
  try {
    answers = cleanAnswers(JSON.parse(String(fd.get("answers") ?? "{}")));
  } catch {
    answers = null;
  }
  if (!answers) return { error: "answers" };
  const db = catalogDb();
  if (!db) return { error: "failed" };
  let token: string;
  try {
    const created = await createTasterLead(db, { contact: parsed.data, answers });
    token = created.token;
    await sendLeadEmail(created.lead.id);
  } catch {
    return { error: "failed" };
  }
  redirect(`/try/result/${token}`);
}

/** Request an offer from /pricing: creates an OFFER lead with the estimator inputs and confirms by email. */
export async function requestOfferAction(_: LeadState, fd: FormData): Promise<LeadState> {
  const parsed = parseLeadContact(contactFromForm(fd), { requireSchool: true });
  const blocked = await guard(fd, parsed.ok ? parsed.data.email : null, "offer");
  if (blocked) return blocked;
  if (!parsed.ok) return { error: "invalid", field: parsed.field };
  let inputs: ReturnType<typeof parseOfferInputs> = null;
  try {
    inputs = parseOfferInputs(JSON.parse(String(fd.get("inputs") ?? "{}")));
  } catch {
    inputs = null;
  }
  if (!inputs) return { error: "invalid" };
  const db = catalogDb();
  if (!db) return { error: "failed" };
  try {
    const { lead } = await createOfferLead(db, { contact: parsed.data, inputs });
    await sendLeadEmail(lead.id);
  } catch {
    return { error: "failed" };
  }
  return { error: null, ok: true };
}
