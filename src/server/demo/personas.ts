import { identityDb, publicOrgBySlug, tenantDb } from "@/lib/tenant-db";
import { initials, pick } from "@/lib/i18n-data";
import { DEMO_SLUG } from "./constants";

export const PRIMARY_PERSONAS = ["admin", "principal", "teacher", "counselor", "career_advisor", "dsl", "student", "parent"];

/** Public persona list for the demo school (no session needed). */
export async function listDemoPersonas(locale: string) {
  const org = await publicOrgBySlug(DEMO_SLUG);
  if (!org) return { org: null, personas: [] };
  const db = tenantDb(org.id);
  const personas = await db.demoPersona.findMany({ where: { orgId: org.id }, orderBy: { order: "asc" } });
  const members = await db.membership.findMany({ where: { id: { in: personas.map((p) => p.membershipId) } } });
  const users = await identityDb.user.findMany({ where: { id: { in: members.map((m) => m.userId) } } });
  return {
    org: { name: pick(locale, org.nameEn, org.nameAr) },
    personas: personas.map((p) => {
      const m = members.find((x) => x.id === p.membershipId);
      const u = users.find((x) => x.id === m?.userId);
      return {
        key: p.key,
        name: u ? pick(locale, u.nameEn, u.nameAr) : "",
        initials: initials(u?.nameEn ?? ""),
        role: pick(locale, p.roleLabelEn, p.roleLabelAr),
        blurb: pick(locale, p.blurbEn, p.blurbAr),
        primary: PRIMARY_PERSONAS.includes(p.key),
      };
    }),
  };
}
