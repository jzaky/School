// Demo data for access management: the family join code, a few invitations in every state, a staff join
// link, and families waiting for approval. Safe to re-run: skipped when the school already has invitations.
// All people are fictional; emails use reserved example domains so nothing is ever sent.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { SeedWorld } from "./demo";
import { generateToken, hashToken } from "../../src/server/access/tokens";

export async function seedAccess(w: SeedWorld) {
  await seedAccessData(w.db, w.orgId, w.now, w.log);
}

const DAY = 86_400_000;

export async function seedAccessData(db: PrismaClient, orgId: string, now: Date, log: (m: string) => void = () => {}) {
  if ((await db.invitation.count({ where: { orgId } })) > 0) return;
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { slug: true, joinCode: true } });
  if (!org.joinCode && org.slug === "horizon") await db.organization.update({ where: { id: orgId }, data: { joinCode: "HRZ-2026" } });

  const personas = await db.demoPersona.findMany({ where: { orgId } });
  const admin = personas.find((p) => p.key === "admin")?.membershipId ?? (await db.membership.findFirst({ where: { orgId, roles: { some: { role: { key: "school_admin" } } } } }))?.id;
  const principal = personas.find((p) => p.key === "principal")?.membershipId ?? admin;
  if (!admin || !principal) return;
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const token = () => hashToken(generateToken());

  // Staff invitations: two waiting, one accepted, one that ran out.
  const staff: Array<{ nameEn: string; email: string; roles: string[]; sent: number; state: "pending" | "accepted" | "expired" }> = [
    { nameEn: "Noura Al Suwaidi", email: "noura.alsuwaidi@horizon.example", roles: ["teacher"], sent: 2, state: "pending" },
    { nameEn: "Tom Whitfield", email: "tom.whitfield@horizon.example", roles: ["teacher", "department_head"], sent: 5, state: "pending" },
    { nameEn: "Priya Menon", email: "priya.menon@horizon.example", roles: ["nurse"], sent: 24, state: "expired" },
  ];
  for (const s of staff) {
    await db.invitation.create({
      data: {
        orgId,
        kind: "STAFF",
        email: s.email,
        nameEn: s.nameEn,
        roleKeys: s.roles,
        tokenHash: token(),
        expiresAt: new Date(ago(s.sent).getTime() + 14 * DAY),
        createdById: s.roles.includes("department_head") ? principal : admin,
        createdAt: ago(s.sent),
        lastSentAt: ago(s.sent),
      },
    });
  }
  // Accepted invitation: the teacher persona joined this way at the start of the year.
  const teacher = personas.find((p) => p.key === "teacher");
  if (teacher) {
    const m = await db.membership.findUnique({ where: { id: teacher.membershipId }, include: { user: true } });
    if (m) {
      await db.invitation.create({
        data: { orgId, kind: "STAFF", email: m.user.email, nameEn: m.user.nameEn, roleKeys: ["teacher"], tokenHash: token(), expiresAt: ago(40), uses: 1, acceptedById: m.userId, createdById: admin, createdAt: ago(54), lastSentAt: ago(54) },
      });
    }
  }
  // Parent invitations from the student records: one accepted, one waiting.
  const guardians = await db.guardian.findMany({ where: { orgId, email: { not: null } }, include: { links: true, membership: { select: { userId: true } } }, orderBy: { lastNameEn: "asc" }, take: 2 });
  for (const [i, g] of guardians.entries()) {
    await db.invitation.create({
      data: {
        orgId,
        kind: "PARENT",
        email: g.email!.toLowerCase(),
        nameEn: `${g.firstNameEn} ${g.lastNameEn}`,
        roleKeys: ["parent"],
        studentIds: g.links.map((l) => l.studentId),
        tokenHash: token(),
        expiresAt: i === 0 ? ago(16) : new Date(ago(3).getTime() + 14 * DAY),
        uses: i === 0 ? 1 : 0,
        acceptedById: i === 0 ? (g.membership?.userId ?? null) : null,
        createdById: admin,
        createdAt: i === 0 ? ago(30) : ago(3),
        lastSentAt: i === 0 ? ago(30) : ago(3),
      },
    });
  }
  // A staff join link shared at the start-of-term staff meeting.
  await db.invitation.create({
    data: { orgId, kind: "STAFF", roleKeys: ["teacher"], maxUses: 25, uses: 4, tokenHash: token(), expiresAt: new Date(now.getTime() + 10 * DAY), createdById: principal, createdAt: ago(4) },
  });

  // Families waiting for approval after joining with the school code.
  const students = await db.student.findMany({ where: { orgId, status: "ACTIVE", dateOfBirth: { not: null } }, orderBy: { studentNo: "desc" }, take: 3 });
  const waiting: Array<{ email: string; nameEn: string; nameAr: string; claims: Prisma.InputJsonValue; days: number; note: string | null }> = [];
  if (students[0]) {
    waiting.push({
      email: "huda.karim@family.horizon.example",
      nameEn: "Huda Karim",
      nameAr: "هدى كريم",
      claims: [{ studentNo: students[0].studentNo, dateOfBirth: students[0].dateOfBirth!.toISOString().slice(0, 10) }],
      days: 1,
      note: "I am the aunt and main carer while the parents are abroad.",
    });
  }
  if (students[1]) {
    waiting.push({
      email: "samir.aziz@family.horizon.example",
      nameEn: "Samir Aziz",
      nameAr: "سمير عزيز",
      claims: [{ grade: students[1].gradeLevel, fullName: `${students[1].firstNameEn} ${students[1].lastNameEn}` }],
      days: 0,
      note: null,
    });
  }
  const parentRole = await db.role.findUnique({ where: { orgId_key: { orgId, key: "parent" } } });
  for (const p of waiting) {
    const user = await db.user.upsert({ where: { email: p.email }, create: { email: p.email, nameEn: p.nameEn, nameAr: p.nameAr }, update: {} });
    const existing = await db.membership.findUnique({ where: { orgId_userId: { orgId, userId: user.id } } });
    if (existing) continue;
    const m = await db.membership.create({ data: { orgId, userId: user.id, status: "PENDING_APPROVAL", createdAt: ago(p.days) } });
    await db.joinRequest.create({ data: { orgId, membershipId: m.id, kind: "PARENT", claimedStudents: p.claims, note: p.note, createdAt: new Date(ago(p.days).getTime() - 3 * 3600_000) } });
    await db.auditEvent.create({ data: { orgId, actorId: m.id, actorUserId: user.id, action: "join.request", entityType: "Membership", entityId: m.id, meta: { kind: "PARENT", claims: 1 }, createdAt: ago(p.days) } });
  }
  // One family approved last week, for the decided tab.
  if (students[2] && parentRole) {
    const email = "leena.farouk@family.horizon.example";
    const user = await db.user.upsert({ where: { email }, create: { email, nameEn: "Leena Farouk", nameAr: "لينا فاروق" }, update: {} });
    if (!(await db.membership.findUnique({ where: { orgId_userId: { orgId, userId: user.id } } }))) {
      const m = await db.membership.create({ data: { orgId, userId: user.id, status: "ACTIVE", createdAt: ago(8) } });
      await db.membershipRole.create({ data: { orgId, membershipId: m.id, roleId: parentRole.id } });
      const g = await db.guardian.create({ data: { orgId, membershipId: m.id, firstNameEn: "Leena", lastNameEn: "Farouk", firstNameAr: "لينا", lastNameAr: "فاروق", email } });
      await db.guardianLink.create({ data: { orgId, guardianId: g.id, studentId: students[2].id, relationshipEn: "Mother", relationshipAr: "الأم" } });
      await db.joinRequest.create({
        data: { orgId, membershipId: m.id, kind: "PARENT", claimedStudents: [{ studentNo: students[2].studentNo, dateOfBirth: students[2].dateOfBirth!.toISOString().slice(0, 10) }], status: "APPROVED", decidedById: admin, decidedAt: ago(7), decisionNote: "Welcome to Horizon.", createdAt: ago(8) },
      });
    }
  }
  log("access: invitations, join link, join code and join requests");
}
