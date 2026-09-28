import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { ownerClient, uid } from "./helpers";

const owner = ownerClient();

type Fixture = {
  orgId: string;
  studentId: string;
  caseId: string;
  requestId: string;
  documentId: string;
  appointmentId: string;
};

async function makeTenant(label: string): Promise<Fixture> {
  const org = await owner.organization.create({
    data: { slug: uid(`iso-${label}`), nameEn: `School ${label}`, nameAr: `مدرسة ${label}` },
  });
  const orgId = org.id;
  const user = await owner.user.create({ data: { email: `${uid(label)}@iso.test`, nameEn: `Staff ${label}` } });
  const membership = await owner.membership.create({ data: { orgId, userId: user.id } });
  const student = await owner.student.create({
    data: {
      orgId,
      studentNo: uid("S"),
      firstNameEn: "Test",
      lastNameEn: label,
      firstNameAr: "اختبار",
      lastNameAr: label,
      gradeLevel: 9,
    },
  });
  const theCase = await owner.case.create({
    data: { orgId, number: uid("CASE"), type: "ACADEMIC", studentId: student.id, titleEn: "Case", titleAr: "حالة" },
  });
  const category = await owner.serviceCategory.create({
    data: { orgId, key: uid("cat"), nameEn: "Cat", nameAr: "فئة" },
  });
  const service = await owner.serviceDefinition.create({
    data: {
      orgId,
      key: uid("svc"),
      categoryId: category.id,
      nameEn: "Svc",
      nameAr: "خدمة",
      descEn: "d",
      descAr: "د",
    },
  });
  const request = await owner.request.create({
    data: {
      orgId,
      number: uid("REQ"),
      serviceId: service.id,
      requesterId: membership.id,
      studentId: student.id,
      titleEn: "Req",
      titleAr: "طلب",
    },
  });
  const document = await owner.document.create({
    data: { orgId, titleEn: "Doc", titleAr: "مستند", studentId: student.id, uploadedById: membership.id },
  });
  const type = await owner.appointmentType.create({
    data: { orgId, key: uid("apt"), nameEn: "Meeting", nameAr: "اجتماع" },
  });
  const appointment = await owner.appointment.create({
    data: {
      orgId,
      typeId: type.id,
      hostId: membership.id,
      bookedById: membership.id,
      studentId: student.id,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 30 * 60000),
    },
  });
  return {
    orgId,
    studentId: student.id,
    caseId: theCase.id,
    requestId: request.id,
    documentId: document.id,
    appointmentId: appointment.id,
  };
}

let A: Fixture;
let B: Fixture;

beforeAll(async () => {
  A = await makeTenant("A");
  B = await makeTenant("B");
});

afterAll(async () => {
  for (const f of [A, B]) {
    if (f) await owner.organization.delete({ where: { id: f.orgId } }).catch(() => undefined);
  }
  // Organization delete cascades memberships only; remove the rest explicitly.
  for (const f of [A, B]) {
    if (!f) continue;
    const where = { orgId: f.orgId };
    await owner.appointment.deleteMany({ where });
    await owner.appointmentType.deleteMany({ where });
    await owner.document.deleteMany({ where });
    await owner.request.deleteMany({ where });
    await owner.serviceDefinition.deleteMany({ where });
    await owner.serviceCategory.deleteMany({ where });
    await owner.case.deleteMany({ where });
    await owner.student.deleteMany({ where });
  }
  await owner.$disconnect();
});

const entities = [
  { name: "Student", key: "studentId", model: "student" },
  { name: "Case", key: "caseId", model: "case" },
  { name: "Request", key: "requestId", model: "request" },
  { name: "Document", key: "documentId", model: "document" },
  { name: "Appointment", key: "appointmentId", model: "appointment" },
] as const;

// Loosely typed delegate access so the same checks run across all five models.
type Delegate = {
  findMany: (a?: unknown) => Promise<Array<{ id: string; orgId: string }>>;
  findUnique: (a: unknown) => Promise<unknown>;
  count: (a?: unknown) => Promise<number>;
  update: (a: unknown) => Promise<unknown>;
  updateMany: (a: unknown) => Promise<{ count: number }>;
  delete: (a: unknown) => Promise<unknown>;
  deleteMany: (a: unknown) => Promise<{ count: number }>;
};
function delegate(client: unknown, model: string): Delegate {
  return (client as Record<string, Delegate>)[model];
}

describe("tenant isolation (RLS against real Postgres)", () => {
  for (const e of entities) {
    describe(e.name, () => {
      it("School A cannot read School B rows", async () => {
        const a = delegate(tenantDb(A.orgId), e.model);
        const rows = await a.findMany();
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.orgId === A.orgId)).toBe(true);
        expect(await a.findUnique({ where: { id: B[e.key] } })).toBeNull();
        expect(await a.count({ where: { id: B[e.key] } })).toBe(0);
      });

      it("School A cannot update School B rows", async () => {
        const a = delegate(tenantDb(A.orgId), e.model);
        const res = await a.updateMany({ where: { id: B[e.key] }, data: { updatedAtMarker: undefined } as never });
        expect(res.count).toBe(0);
        await expect(a.update({ where: { id: B[e.key] }, data: {} })).rejects.toThrow();
      });

      it("School A cannot delete School B rows", async () => {
        const a = delegate(tenantDb(A.orgId), e.model);
        const res = await a.deleteMany({ where: { id: B[e.key] } });
        expect(res.count).toBe(0);
        await expect(a.delete({ where: { id: B[e.key] } })).rejects.toThrow();
        const stillThere = await delegate(owner, e.model).count({ where: { id: B[e.key] } });
        expect(stillThere).toBe(1);
      });
    });
  }

  it("School A cannot insert rows into School B (client guard)", async () => {
    await expect(
      tenantDb(A.orgId).student.create({
        data: {
          orgId: B.orgId,
          studentNo: uid("X"),
          firstNameEn: "Evil",
          lastNameEn: "Insert",
          firstNameAr: "x",
          lastNameAr: "y",
          gradeLevel: 9,
        },
      }),
    ).rejects.toThrow(/Cross-tenant write blocked/);
  });

  it("School A cannot insert rows into School B (database policy, bypassing the client guard)", async () => {
    const attempts: Array<(tx: Parameters<Parameters<typeof tenantTx>[1]>[0]) => Promise<unknown>> = [
      (tx) =>
        tx.student.create({
          data: { orgId: B.orgId, studentNo: uid("X"), firstNameEn: "a", lastNameEn: "b", firstNameAr: "c", lastNameAr: "d", gradeLevel: 9 },
        }),
      (tx) =>
        tx.case.create({
          data: { orgId: B.orgId, number: uid("C"), type: "ACADEMIC", studentId: B.studentId, titleEn: "x", titleAr: "y" },
        }),
      (tx) =>
        tx.document.create({ data: { orgId: B.orgId, titleEn: "x", titleAr: "y", uploadedById: "m" } }),
      (tx) =>
        tx.request.create({
          data: { orgId: B.orgId, number: uid("R"), serviceId: "s", requesterId: "m", titleEn: "x", titleAr: "y" },
        }),
      (tx) =>
        tx.appointment.create({
          data: { orgId: B.orgId, typeId: "t", hostId: "h", bookedById: "b", startsAt: new Date(), endsAt: new Date() },
        }),
    ];
    for (const attempt of attempts) {
      await expect(tenantTx(A.orgId, attempt)).rejects.toThrow();
    }
    const count = await owner.student.count({ where: { orgId: B.orgId } });
    expect(count).toBe(1);
  });

  it("School A cannot move its own row into School B", async () => {
    await expect(
      tenantTx(A.orgId, (tx) => tx.student.update({ where: { id: A.studentId }, data: { orgId: B.orgId } })),
    ).rejects.toThrow();
  });

  it("a connection with no tenant context sees nothing", async () => {
    const [students, cases, requests, docs, appts] = await Promise.all([
      prisma.student.count(),
      prisma.case.count(),
      prisma.request.count(),
      prisma.document.count(),
      prisma.appointment.count(),
    ]);
    expect(students + cases + requests + docs + appts).toBe(0);
  });

  it("the app role is not a superuser and cannot bypass RLS", async () => {
    const rows = await prisma.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});
