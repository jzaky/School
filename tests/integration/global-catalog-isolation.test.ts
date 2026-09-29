import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantDb, tenantTx } from "@/lib/tenant-db";
import { prisma } from "@/lib/prisma";
import { ownerClient, uid } from "./helpers";

// Shared catalog tables: rows with a null orgId are the global catalog. Every school reads
// them; only the owner role (platform pipeline) writes them. School rows stay private.
const owner = ownerClient();

let orgA: string;
let orgB: string;
let globalUni: string;
let schoolUni: string;
const subjectKey = uid("subj");

function uni(orgId: string | null, label: string) {
  return {
    orgId,
    key: uid(label),
    nameEn: `University ${label}`,
    nameAr: `جامعة ${label}`,
    countryCode: "GB",
    cityEn: "London",
    cityAr: "لندن",
  };
}

beforeAll(async () => {
  orgA = (await owner.organization.create({ data: { slug: uid("gc-a"), nameEn: "A", nameAr: "أ" } })).id;
  orgB = (await owner.organization.create({ data: { slug: uid("gc-b"), nameEn: "B", nameAr: "ب" } })).id;
  globalUni = (await owner.university.create({ data: uni(null, "global") })).id;
  schoolUni = (await owner.university.create({ data: uni(orgA, "own") })).id;
  await owner.canonicalSubject.create({ data: { key: subjectKey, nameEn: "Test subject", nameAr: "مادة", category: "TEST" } });
});

afterAll(async () => {
  await owner.university.deleteMany({ where: { id: { in: [globalUni, schoolUni] } } });
  await owner.university.deleteMany({ where: { orgId: { in: [orgA, orgB] } } });
  await owner.canonicalSubject.deleteMany({ where: { key: subjectKey } });
  await owner.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
});

describe("global catalog isolation", () => {
  it("every school reads global rows, only the owner school reads its own", async () => {
    const seenA = await tenantDb(orgA).university.findMany({ where: { id: { in: [globalUni, schoolUni] } } });
    const seenB = await tenantDb(orgB).university.findMany({ where: { id: { in: [globalUni, schoolUni] } } });
    expect(seenA.map((u) => u.id).sort()).toEqual([globalUni, schoolUni].sort());
    expect(seenB.map((u) => u.id)).toEqual([globalUni]);
  });

  it("a school cannot insert a global row", async () => {
    await expect(
      tenantTx(orgA, (tx) => tx.university.create({ data: uni(null, "sneaky") })),
    ).rejects.toThrow();
  });

  it("a school cannot change, claim or delete a global row", async () => {
    const renamed = await tenantTx(orgA, (tx) =>
      tx.university.updateMany({ where: { id: globalUni }, data: { nameEn: "Hijacked" } }),
    );
    expect(renamed.count).toBe(0);
    const claimed = await tenantTx(orgA, (tx) =>
      tx.university.updateMany({ where: { id: globalUni }, data: { orgId: orgA } }),
    );
    expect(claimed.count).toBe(0);
    const removed = await tenantTx(orgA, (tx) => tx.university.deleteMany({ where: { id: globalUni } }));
    expect(removed.count).toBe(0);
    const row = await owner.university.findUnique({ where: { id: globalUni } });
    expect(row?.nameEn).toBe("University global");
    expect(row?.orgId).toBeNull();
  });

  it("another school cannot change a school's own row", async () => {
    const res = await tenantTx(orgB, (tx) =>
      tx.university.updateMany({ where: { id: schoolUni }, data: { nameEn: "Hijacked" } }),
    );
    expect(res.count).toBe(0);
  });

  it("global reference tables are read-only for the app role", async () => {
    const found = await tenantDb(orgA).canonicalSubject.findUnique({ where: { key: subjectKey } });
    expect(found?.nameEn).toBe("Test subject");
    await expect(
      prisma.canonicalSubject.create({ data: { key: uid("x"), nameEn: "x", nameAr: "x", category: "TEST" } }),
    ).rejects.toThrow();
    await expect(
      prisma.canonicalSubject.update({ where: { key: subjectKey }, data: { nameEn: "changed" } }),
    ).rejects.toThrow();
  });
});
