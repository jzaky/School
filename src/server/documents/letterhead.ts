import "server-only";
// The school's own letterhead for generated PDFs: its logo (stored privately through the storage module,
// see /api/org/logo), its names, short name, emirate and main campus address. The logo is read from R2 or
// local storage, converted to a small PNG (sharp, when installed; pdfkit reads PNG and JPEG directly
// otherwise) and cached in memory by storage key (each upload has a new key).
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { TenantDb } from "@/lib/tenant-db";
import { r2Configured, s3 } from "./r2";
import { readLocal } from "./storage";
import type { Letterhead } from "./pdf";

const MAX_BYTES = 5 * 1024 * 1024;
const cache = new Map<string, Buffer | null>();

const EMIRATE_AR: Record<string, string> = {
  "Abu Dhabi": "أبوظبي",
  Dubai: "دبي",
  Sharjah: "الشارقة",
  Ajman: "عجمان",
  "Umm Al Quwain": "أم القيوين",
  "Ras Al Khaimah": "رأس الخيمة",
  Fujairah: "الفجيرة",
};

async function readStored(key: string): Promise<Buffer | null> {
  if (key.startsWith("r2:")) {
    if (!r2Configured()) return null;
    const res = await s3().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key.slice(3) }));
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  }
  return readLocal(key);
}

const isPng = (b: Buffer) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47;
const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;

/** A PNG or JPEG that pdfkit can draw, at most 480 px on its longest side, or null. */
export async function prepareLogo(raw: Buffer): Promise<Buffer | null> {
  if (raw.length === 0 || raw.length > MAX_BYTES) return null;
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(raw).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    // Without sharp (or for an image it cannot read), fall back to formats pdfkit reads itself.
    return isPng(raw) || isJpeg(raw) ? raw : null;
  }
}

/** The school's logo ready for a PDF, or null when there is none or it cannot be read. */
export async function loadLogo(key: string | null | undefined): Promise<Buffer | null> {
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  let out: Buffer | null = null;
  try {
    const raw = await readStored(key);
    out = raw ? await prepareLogo(raw) : null;
  } catch {
    out = null;
  }
  if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  cache.set(key, out);
  return out;
}

type OrgLike = { nameEn: string; nameAr: string; shortNameEn: string | null; shortNameAr: string | null; emirate: string; logoUrl: string | null };

/** Everything a PDF needs to carry the school's identity. */
export async function letterheadFor(db: TenantDb, org: OrgLike): Promise<Letterhead> {
  const [campus, logo] = await Promise.all([db.campus.findFirst({ where: { isMain: true }, select: { addressEn: true, addressAr: true } }), loadLogo(org.logoUrl)]);
  const emirateAr = EMIRATE_AR[org.emirate] ?? org.emirate;
  const withCountry = (a: string | null | undefined, city: string, country: string, sep: string) => {
    const base = a?.trim() || city;
    return base.includes(country) ? base : `${base}${sep}${country}`;
  };
  return {
    school: { en: org.nameEn, ar: org.nameAr },
    shortEn: org.shortNameEn || org.nameEn,
    emirate: { en: org.emirate, ar: emirateAr },
    address: {
      en: withCountry(campus?.addressEn, org.emirate, "United Arab Emirates", ", "),
      ar: withCountry(campus?.addressAr, emirateAr, "الإمارات العربية المتحدة", "، "),
    },
    logo,
  };
}
