"use server";

// Platform admin actions (PLATFORM_ADMIN_EMAILS only). Writes go to platform tables on the owner client and
// are audited in the admin's own school.
import { revalidatePath } from "next/cache";
import { MODULES, normalizePricing } from "@/lib/roi";
import { audit } from "@/server/audit/audit";
import { platformDb, requirePlatformAdmin } from "@/server/platform/admin";
import { savePricing } from "./pricing-store";

export type PricingState = { ok: boolean; error?: "invalid" | "forbidden" | "failed"; savedAt?: number };

function num(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export async function savePricingAction(_: PricingState, fd: FormData): Promise<PricingState> {
  let ctx;
  try {
    ctx = await requirePlatformAdmin();
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const perStudent = Object.fromEntries(MODULES.map((m) => [m, num(fd.get(`price_${m}`))]));
  const raw = {
    currency: String(fd.get("currency") ?? "AED").trim().toUpperCase(),
    perStudent,
    pilotDiscountPct: num(fd.get("pilotDiscountPct")) ?? 0,
    pilotMonths: num(fd.get("pilotMonths")) ?? 3,
    minimumAnnual: num(fd.get("minimumAnnual")),
    minimumPerCampus: num(fd.get("minimumPerCampus")),
    published: fd.get("published") === "on",
  };
  const bad = [...Object.values(perStudent), raw.pilotDiscountPct, raw.pilotMonths, raw.minimumAnnual, raw.minimumPerCampus].some((v) => typeof v === "number" && Number.isNaN(v));
  if (bad || !/^[A-Z]{3}$/.test(raw.currency) || raw.pilotDiscountPct > 100 || raw.pilotMonths < 1 || raw.pilotMonths > 12) return { ok: false, error: "invalid" };
  if (raw.published && perStudent.core == null) return { ok: false, error: "invalid" };
  try {
    const saved = await savePricing(platformDb(), normalizePricing(raw), ctx.user.id);
    await audit(ctx.db, ctx.orgId, { actorId: ctx.membershipId, actorUserId: ctx.user.id, action: "platform.pricing_updated", entityType: "PlatformSetting", entityId: "pricing", meta: { published: saved.published, currency: saved.currency } });
  } catch {
    return { ok: false, error: "failed" };
  }
  revalidatePath("/pricing");
  return { ok: true, savedAt: Date.now() };
}
