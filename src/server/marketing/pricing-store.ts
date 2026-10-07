// Pricing settings for /pricing, kept in PlatformSetting (key "pricing"). Owner client only.
// Unset by default: until a platform admin publishes prices, /pricing shows "Request an offer".
import type { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_PRICING, normalizePricing, type PricingConfig } from "@/lib/roi";

type Db = Pick<PrismaClient, "platformSetting">;
export const PRICING_KEY = "pricing";

export async function getPricing(db: Db): Promise<PricingConfig> {
  const row = await db.platformSetting.findUnique({ where: { key: PRICING_KEY } });
  return row ? normalizePricing(row.value) : DEFAULT_PRICING;
}

/** Public pages fall back to "no prices" when the platform database is not reachable. */
export async function getPricingSafe(db: Db | null): Promise<PricingConfig> {
  if (!db) return DEFAULT_PRICING;
  try {
    return await getPricing(db);
  } catch {
    return DEFAULT_PRICING;
  }
}

export async function savePricing(db: Db, raw: unknown, updatedById: string | null): Promise<PricingConfig> {
  const value = normalizePricing(raw);
  await db.platformSetting.upsert({
    where: { key: PRICING_KEY },
    create: { key: PRICING_KEY, value: value as unknown as Prisma.InputJsonValue, updatedById },
    update: { value: value as unknown as Prisma.InputJsonValue, updatedById },
  });
  return value;
}
