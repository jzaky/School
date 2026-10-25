// Demo conversations on requests, private sick leave for a teacher and cover notes.
// - Rania Nasser's requests: Adam's sick days (shared messages, a private note between the registrar and the
//   school nurse), Yara's late bus (shared messages, a staff-only note between Aisha and Mona, private notes
//   between Aisha and the principal) and an older letter request.
// - Two other families, one writing in Arabic.
// - Daniel Carter: sick leave last fortnight (a leave request with a certificate, approved, cover arranged and
//   done) and a hospital appointment on the next school day with cover notes for his classes.
// Runs inside the demo seed after the timetable, so the tenant is freshly wiped and every step is safe to re-run.
import type { MessageVisibility, Prisma } from "@prisma/client";
import { execCtx } from "@/server/db";
import { notify } from "@/server/notify/notify";
import { ensureConversationTemplates } from "@/server/requests/conversation";
import { submitRequest } from "@/server/services/submit";
import { decideApproval } from "@/server/workflows/approvals";
import { reportAbsence } from "@/server/timetable/cover";
import { at, schoolDay } from "./lib";
import { sampleData } from "./history";
import type { SeedWorld } from "./demo";

type Msg = { by: string; at: Date; body: string; vis?: MessageVisibility; to?: string[] };

const dayKey = (offset: number, now: Date) => {
  const d = new Date(now.getTime() + 4 * 3600_000);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

export async function seedConversations(w: SeedWorld) {
  const { db, orgId, now, staff } = w;
  const tx = db as unknown as Prisma.TransactionClient;
  await ensureConversationTemplates(tx, orgId);
  const S = (key: string) => staff.get(key)?.membershipId ?? "";
  const aisha = S("aisha_rahman");
  const omar = S("omar_al_mansoori");
  const mona = S("registrar_main");
  const grace = S("nurse_main");
  const daniel = S("daniel_carter");
  const rania = w.rania.membershipId;
  let clamp = 0;
  /** Never in the future: a few minutes before now, in order. */
  const past = (d: Date) => (d.getTime() < now.getTime() - 60_000 ? d : new Date(now.getTime() - 60_000 * (40 - Math.min(++clamp, 35))));
  const ec = (when: Date, actorId?: string | null) => execCtx(tx, orgId, { now: past(when), quiet: true, actorId: actorId ?? null });

  async function thread(requestId: string | undefined, msgs: Msg[], reads: Array<[string, Date]>) {
    if (!requestId) return;
    for (const m of msgs) {
      await db.requestMessage.create({ data: { orgId, requestId, membershipId: m.by, visibility: m.vis ?? "SHARED", privateToIds: m.to ?? [], body: m.body, createdAt: past(m.at) } });
    }
    for (const [membershipId, when] of reads) {
      if (!membershipId) continue;
      await db.requestThreadRead.upsert({
        where: { requestId_membershipId: { requestId, membershipId } },
        create: { orgId, requestId, membershipId, lastReadAt: past(when) },
        update: { lastReadAt: past(when) },
      });
    }
  }
  async function tell(requestId: string, recipients: string[], templateKey: string, author: string, when: Date) {
    const r = await db.request.findUniqueOrThrow({ where: { id: requestId } });
    const a = await db.membership.findUniqueOrThrow({ where: { id: author }, include: { user: true } });
    await notify(ec(when), {
      recipients,
      templateKey,
      kind: "request_message",
      vars: { number: r.number, title: { en: r.titleEn, ar: r.titleAr }, author: { en: a.user.nameEn, ar: a.user.nameAr || a.user.nameEn } },
      href: `/requests/${r.id}#conversation`,
      sensitivity: r.sensitivity,
      channels: ["IN_APP"],
      idempotencyBase: `seed:${r.id}:${templateKey}:${author}`,
    });
  }
  const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);

  // ------------------------------------------------------------------
  // Adam's sick days (submitted and approved in history.ts)
  // ------------------------------------------------------------------
  const sick = await db.request.findFirst({ where: { orgId, requesterId: rania, studentId: w.adam.id, service: { key: "absence_request" } }, orderBy: { submittedAt: "desc" } });
  if (sick) {
    const t0 = sick.submittedAt;
    const msgs: Msg[] = [
      { by: mona, at: plus(t0, 74), body: "Thank you for letting us know, Mrs Nasser. Adam's absence is recorded as excused for both days, and his teachers know he is away. We hope he feels better soon." },
      { by: mona, at: plus(t0, 78), vis: "PRIVATE", to: [grace], body: "Grace, the certificate says tonsillitis with two days of rest. Could you check in with Adam on his first day back, in case he needs anything during the day?" },
      { by: grace, at: plus(t0, 123), vis: "PRIVATE", to: [mona], body: "Will do. I'll see him at first break on his first day back and remind him he can come to the clinic if his throat is still sore." },
      { by: rania, at: plus(t0, 338), body: "Thank you. Is there anything he should catch up on while he is home?" },
      { by: mona, at: plus(t0, 363), body: "His teachers have posted this week's work on the class pages. There is no rush, Adam can catch up when he is well." },
      { by: rania, at: at(schoolDay(-1, now), 18, 10, now), body: "He is feeling much better, thank you. He will be back tomorrow." },
    ];
    await thread(sick.id, msgs, [
      [rania, msgs[5].at],
      [mona, msgs[4].at],
      [grace, msgs[2].at],
    ]);
    await tell(sick.id, [mona], "request_reply", rania, msgs[5].at);
  }

  // ------------------------------------------------------------------
  // Yara's late bus: an open conversation with staff-only and private notes
  // ------------------------------------------------------------------
  const transport = w.services.get("transport_request");
  let bus: { id: string } | null = null;
  if (transport) {
    const t0 = past(at(-3, 19, 30, now));
    const data = sampleData(transport.schema, w.yara, w.rania.name.en, {
      requestType: "new_registration",
      area: "al_barsha",
      pickupAddress: "Villa 14, Street 23, Al Barsha 2, next to the park (art club days: Tuesday and Thursday)",
      tripType: "afternoon_only",
      startDate: dayKey(7, now),
      contactPhone: "+971 50 555 0142",
    });
    bus = await submitRequest(ec(t0, rania), { serviceId: transport.id, requesterId: rania, studentId: w.yara.id, data });
    const homeroom = await db.approvalAssignee.findFirst({ where: { orgId, status: "PENDING", approval: { requestId: bus.id, status: "PENDING" } } });
    if (homeroom?.membershipId) {
      await decideApproval(ec(at(-2, 13, 0, now), homeroom.membershipId), { assigneeRowId: homeroom.id, deciderMembershipId: homeroom.membershipId, decision: "APPROVED", comment: "Fine from my side.", signatureName: null });
    }
    const msgs: Msg[] = [
      { by: rania, at: plus(t0, 2), body: "Hello, Yara has joined the art club on Tuesdays and Thursdays, which finishes at 4:30. Is there a late bus to Al Barsha on those days? The form only lets me choose afternoon trips." },
      { by: aisha, at: at(-2, 8, 40, now), body: "Good morning, Mrs Nasser. Thank you for the details. We are checking the late bus routes with our transport team and will come back to you by Thursday." },
      { by: aisha, at: at(-2, 8, 45, now), vis: "STAFF", body: "Mona, can you check whether the 4:45 late bus to Al Barsha still has seats for Grade 6 on Tuesdays and Thursdays? Please don't confirm a date to the family until transport replies." },
      { by: mona, at: at(-2, 11, 10, now), vis: "STAFF", body: "Route 7 has two seats on both days. Transport will confirm the exact stop on Wednesday." },
      { by: aisha, at: at(-2, 11, 30, now), vis: "PRIVATE", to: [omar], body: "Omar, for your awareness only: this is the family's second transport question this term. If the late route carries an extra fee they may ask for a waiver. Nothing to decide yet." },
      { by: omar, at: at(-2, 12, 5, now), vis: "PRIVATE", to: [aisha], body: "Thanks, Aisha. If a waiver request comes, bring it to me directly." },
      { by: aisha, at: at(-1, 9, 15, now), body: "Good news: there is a seat for Yara on the 4:45 late bus (route 7) on Tuesdays and Thursdays. The drop off point is the same as her usual afternoon stop. Shall we start from next Tuesday?" },
      { by: rania, at: at(-1, 20, 5, now), body: "Yes please, from next Tuesday. Thank you so much for sorting this out!" },
      { by: aisha, at: at(0, 8, 30, now), body: "All set. Yara is on route 7 from next Tuesday. The bus supervisor will call you the day before." },
    ];
    await thread(bus.id, msgs, [
      [rania, msgs[7].at],
      [aisha, msgs[8].at],
      [mona, msgs[3].at],
      [omar, msgs[5].at],
    ]);
    await tell(bus.id, [omar], "request_private_note", aisha, msgs[4].at);
    await tell(bus.id, [rania], "request_message", aisha, msgs[8].at);
  }

  // ------------------------------------------------------------------
  // Rania's older letter request
  // ------------------------------------------------------------------
  const letter = await db.request.findFirst({ where: { orgId, requesterId: rania, service: { key: "document_request" } }, orderBy: { submittedAt: "asc" } });
  if (letter) {
    const t0 = letter.submittedAt;
    const msgs: Msg[] = [
      { by: rania, at: plus(t0, 4), body: "The visa office asked for the letter to show Adam's grade and the academic year. Is that included?" },
      { by: mona, at: plus(t0, 14 * 60 + 25), body: "Yes. The enrollment letter shows Adam's grade, the academic year and the school's details, in English and Arabic. It will be ready to download on this page this morning." },
      { by: rania, at: plus(t0, 15 * 60), body: "Perfect, thank you Mona." },
    ];
    await thread(letter.id, msgs, [
      [rania, msgs[2].at],
      [mona, msgs[2].at],
    ]);
  }

  // ------------------------------------------------------------------
  // Other families
  // ------------------------------------------------------------------
  const otherLetter = await db.request.findFirst({ where: { orgId, requesterId: { not: rania }, status: "COMPLETED", service: { key: "document_request" }, student: { gradeLevel: { gte: 7 } } }, orderBy: { submittedAt: "desc" } });
  if (otherLetter) {
    const t0 = otherLetter.submittedAt;
    const msgs: Msg[] = [
      { by: otherLetter.requesterId, at: plus(t0, 6), body: "Could the letter mention that our son has been at the school since Grade 1? The bank asked for the start date." },
      { by: mona, at: plus(t0, 15 * 60 + 5), body: "Of course. I have added the date he joined Horizon to the letter. You can download it from this page." },
      { by: otherLetter.requesterId, at: plus(t0, 16 * 60), body: "Thank you, that is exactly what they needed." },
    ];
    await thread(otherLetter.id, msgs, [
      [otherLetter.requesterId, msgs[2].at],
      [mona, msgs[2].at],
    ]);
  }
  // A father writing in Arabic about an early pickup.
  const pickup = await db.request.findFirst({ where: { orgId, requesterId: { not: rania }, service: { key: "early_pickup" } }, orderBy: { submittedAt: "desc" } });
  if (pickup) {
    const t0 = pickup.submittedAt;
    const msgs: Msg[] = [
      { by: pickup.requesterId, at: plus(t0, 3), body: "السلام عليكم، سأصل لاستلام ابنتي الساعة 11:30 بدلًا من 12:00 بسبب موعد في المستشفى. هل هذا ممكن؟" },
      { by: mona, at: plus(t0, 40), body: "وعليكم السلام، نعم بالتأكيد. ستكون ابنتكم في انتظاركم عند مكتب الاستقبال الساعة 11:30، ونرجو إحضار بطاقة الهوية." },
      { by: mona, at: plus(t0, 42), vis: "STAFF", body: "Reception: please have her ready at 11:30, not 12:00. Father collecting, ID on file." },
      { by: pickup.requesterId, at: plus(t0, 55), body: "شكرًا جزيلًا لكم." },
    ];
    await thread(pickup.id, msgs, [
      [pickup.requesterId, msgs[3].at],
      [mona, msgs[3].at],
    ]);
  }

  // ------------------------------------------------------------------
  // Daniel Carter: sick leave with a certificate (private), cover arranged and done
  // ------------------------------------------------------------------
  const leaveSvc = w.services.get("staff_leave");
  if (leaveSvc && daniel && omar) {
    const first = schoolDay(-12, now);
    const t0 = at(first, 6, 50, now);
    const data = sampleData(leaveSvc.schema, null, "Daniel Carter", {
      leaveType: "sick",
      startDate: dayKey(first, now),
      endDate: dayKey(schoolDay(-11, now), now),
      daysRequested: 2,
      medicalCertificate: { name: "Sick leave certificate - D Carter.pdf", size: 152_000, key: "sample:medical-certificate", type: "application/pdf" },
      coverPlan: "Grade 9: continue the worksheet from Monday's lesson, questions 5 to 10. Answers are in the blue folder on my desk.",
      signature: "Daniel Carter",
    });
    const leave = await submitRequest(ec(t0, daniel), { serviceId: leaveSvc.id, requesterId: daniel, studentId: null, data });
    const row = await db.approvalAssignee.findFirst({ where: { orgId, membershipId: omar, status: "PENDING", approval: { requestId: leave.id, status: "PENDING" } } });
    if (row) await decideApproval(ec(at(first, 7, 25, now), omar), { assigneeRowId: row.id, deciderMembershipId: omar, decision: "APPROVED", comment: "Get well soon, Daniel.", signatureName: null });
    // Cover was given on those days.
    await db.coverAssignment.updateMany({ where: { orgId, absence: { requestId: leave.id }, status: "ASSIGNED" }, data: { status: "DONE" } });
    const msgs: Msg[] = [
      { by: daniel, at: plus(t0, 3), body: "Sorry for the short notice. My lesson notes for cover are in the form." },
      { by: aisha, at: at(first, 7, 40, now), body: "Get well soon, Daniel. Cover is arranged for all your lessons on both days, and the substitutes have your notes." },
      { by: aisha, at: at(first, 7, 45, now), vis: "PRIVATE", to: [omar], body: "Omar, Daniel asked to swap his Thursday duty next week while he recovers. I have moved it to Richard. No other changes needed." },
    ];
    await thread(leave.id, msgs, [
      [daniel, msgs[1].at],
      [aisha, msgs[2].at],
      [omar, msgs[2].at],
    ]);
  }

  // Daniel's hospital follow-up on the next school day: private reason, cover notes for his classes.
  if (daniel) {
    // The first school day after today on which Daniel teaches, so his lessons need cover.
    const teaching = new Set((await db.timetableSlot.findMany({ where: { orgId, teacherMembershipId: daniel }, select: { dayOfWeek: true } })).map((s) => s.dayOfWeek));
    let day = schoolDay(1, now);
    for (let n = 1; n <= 5; n++) {
      const d = schoolDay(n, now);
      if (teaching.has(new Date(`${dayKey(d, now)}T00:00:00Z`).getUTCDay())) {
        day = d;
        break;
      }
    }
    try {
      await reportAbsence(ec(at(-1, 16, 20, now), daniel), {
        membershipId: daniel,
        startsOn: dayKey(day, now),
        endsOn: dayKey(day, now),
        allDay: true,
        notes: "Grade 9: pupils continue the worksheet on page 12 in pairs, then the five quiz questions on the board. Answers are in the blue folder on my desk.",
        reasonKind: "MEDICAL_APPOINTMENT",
        privateReason: "Hospital follow-up appointment. Back the next day.",
        reportedById: daniel,
      });
    } catch {
      // An overlapping absence already exists for that day; the cover board shows it.
    }
  }
}
