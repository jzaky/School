// OneRoster CSV files (1.1 and 1.2), as a zip of orgs.csv, academicSessions.csv, courses.csv, users.csv,
// classes.csv, enrollments.csv, demographics.csv and (1.2) roles.csv, with manifest.csv saying whether each file is
// a bulk (full) or delta export. Rows become the same records as the REST feed. Sizes are capped before anything
// is decompressed, so a crafted archive cannot exhaust memory.
import { inflateRawSync } from "node:zlib";
import { decodeText, parseCsvTable } from "@/server/imports/files";
import { oneRosterClass, oneRosterCourse, oneRosterDemographic, oneRosterEnrollment, oneRosterOrg, oneRosterSession, oneRosterUser, type Staged } from "@/lib/rostering/records";

export class CsvRosterError extends Error {
  constructor(public code: "NOT_ZIP" | "TOO_LARGE" | "NO_USERS" | "UNREADABLE" | "BAD_HEADER") {
    super(`oneroster-csv:${code}`);
  }
}

export const MAX_ZIP_BYTES = 10 * 1024 * 1024;
const MAX_UNZIPPED = 80 * 1024 * 1024;
const MAX_ROWS = 200_000;

/** Reads a zip's entries with size limits checked from the central directory before inflating. */
export function readZipGuarded(buf: Buffer): Map<string, Buffer> {
  if (buf.length > MAX_ZIP_BYTES) throw new CsvRosterError("TOO_LARGE");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new CsvRosterError("NOT_ZIP");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let total = 0;
  try {
    for (let n = 0; n < count && n < 200; n++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) throw new CsvRosterError("UNREADABLE");
      const method = buf.readUInt16LE(p + 10);
      const size = buf.readUInt32LE(p + 20);
      const rawSize = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const commentLen = buf.readUInt16LE(p + 32);
      const localOffset = buf.readUInt32LE(p + 42);
      const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
      total += rawSize;
      if (total > MAX_UNZIPPED) throw new CsvRosterError("TOO_LARGE");
      const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
      const data = buf.subarray(start, start + size);
      const base = name.split("/").pop()!.toLowerCase();
      if (base.endsWith(".csv")) out.set(base, method === 8 ? inflateRawSync(data, { maxOutputLength: Math.max(rawSize, 1) }) : Buffer.from(data));
      p += 46 + nameLen + extraLen + commentLen;
    }
  } catch (e) {
    if (e instanceof CsvRosterError) throw e;
    throw new CsvRosterError("UNREADABLE");
  }
  return out;
}

function rows(buf: Buffer | undefined): Array<Record<string, string>> {
  if (!buf) return [];
  const table = parseCsvTable(decodeText(buf)).filter((r) => r.some((c) => c.trim()));
  if (table.length === 0) return [];
  const header = table[0].map((h) => h.trim());
  if (!header.includes("sourcedId") && !header.includes("propertyName")) throw new CsvRosterError("BAD_HEADER");
  return table.slice(1, MAX_ROWS + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export type CsvRoster = { records: Staged[]; mode: "FULL" | "DELTA"; files: string[] };

export function parseOneRosterZip(buf: Buffer): CsvRoster {
  const files = readZipGuarded(buf);
  const users = rows(files.get("users.csv"));
  if (!users.length) throw new CsvRosterError("NO_USERS");
  // manifest.csv: propertyName,value rows such as file.users,bulk or file.users,delta.
  const manifest = new Map(rows(files.get("manifest.csv")).map((r) => [r.propertyName, (r.value ?? "").toLowerCase()]));
  const mode = [...manifest.entries()].some(([k, v]) => k.startsWith("file.") && v === "delta") ? "DELTA" : "FULL";
  // OneRoster 1.2 CSV moves roles to roles.csv; the primary role per user is used.
  const roleRows = rows(files.get("roles.csv"));
  const roleOf = new Map<string, { role: string; org: string }>();
  for (const r of roleRows) {
    const prev = roleOf.get(r.userSourcedId);
    if (!prev || r.roleType?.toLowerCase() === "primary") roleOf.set(r.userSourcedId, { role: r.role, org: r.orgSourcedId });
  }
  const records: Staged[] = [];
  const add = (x: Staged | null) => x && records.push(x);
  rows(files.get("orgs.csv")).forEach((r) => add(oneRosterOrg(r)));
  rows(files.get("academicsessions.csv")).forEach((r) => add(oneRosterSession(r)));
  rows(files.get("courses.csv")).forEach((r) => add(oneRosterCourse(r)));
  for (const u of users) {
    const fromRoles = roleOf.get(u.sourcedId);
    add(oneRosterUser({ ...u, role: u.role || fromRoles?.role, orgSourcedIds: u.orgSourcedIds || fromRoles?.org, grades: u.grades }));
  }
  rows(files.get("classes.csv")).forEach((r) => add(oneRosterClass(r)));
  rows(files.get("enrollments.csv")).forEach((r) => add(oneRosterEnrollment(r)));
  rows(files.get("demographics.csv")).forEach((r) => add(oneRosterDemographic(r)));
  return { records, mode, files: [...files.keys()].sort() };
}
