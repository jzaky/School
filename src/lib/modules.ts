// Per-school modules. A school switches optional modules on and off in the setup wizard (Organization.enabledModules).
// Core modules are always on. An empty enabledModules list means "all defaults", which is every module on.
// Pure: safe for client and server.

export const CORE_MODULES = ["requests", "services", "cases", "safeguarding", "documents", "calendar"] as const;
export const OPTIONAL_MODULES = ["meetings", "timetable", "grades", "registration", "exams", "trips", "career", "pathways", "curriculum", "analytics"] as const;

export type CoreModule = (typeof CORE_MODULES)[number];
export type OptionalModule = (typeof OPTIONAL_MODULES)[number];
export type ModuleKey = CoreModule | OptionalModule;

/** Route prefixes (without locale) that belong to an optional module. The longest matching prefix wins. */
export const MODULE_ROUTES: Record<OptionalModule, string[]> = {
  meetings: ["/meetings", "/book"],
  timetable: ["/timetable", "/admin/timetable", "/admin/cover"],
  grades: ["/grades"],
  registration: ["/subjects", "/admin/registration"],
  exams: ["/exams", "/admin/exams"],
  trips: ["/trips"],
  career: ["/career"],
  pathways: ["/career/pathways", "/career/universities", "/career/applications", "/career/catalog"],
  curriculum: ["/curriculum"],
  analytics: ["/analytics"],
};

/** Modules that only make sense with another module on. Switching the parent off hides these too. */
export const MODULE_REQUIRES: Partial<Record<OptionalModule, OptionalModule>> = { pathways: "career" };

type OrgModules = { enabledModules?: string[] | null } | null | undefined;

const isOptional = (k: string): k is OptionalModule => (OPTIONAL_MODULES as readonly string[]).includes(k);
export const isCoreModule = (k: string): k is CoreModule => (CORE_MODULES as readonly string[]).includes(k);

/** Is this module on for the school? Core modules always are; an empty list means every module is on. */
export function moduleEnabled(org: OrgModules, key: ModuleKey): boolean {
  if (isCoreModule(key)) return true;
  const list = org?.enabledModules ?? [];
  if (list.length === 0) return true;
  if (!list.includes(key)) return false;
  const parent = MODULE_REQUIRES[key];
  return parent ? list.includes(parent) : true;
}

/** The optional module a path belongs to, or null for core and shared pages. */
export function moduleForPath(path: string): OptionalModule | null {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best: { key: OptionalModule; len: number } | null = null;
  for (const key of OPTIONAL_MODULES) {
    for (const prefix of MODULE_ROUTES[key]) {
      if ((clean === prefix || clean.startsWith(`${prefix}/`)) && (!best || prefix.length > best.len)) best = { key, len: prefix.length };
    }
  }
  return best?.key ?? null;
}

/** Can a link to this path be shown? False when it leads into a switched-off module. */
export function pathEnabled(org: OrgModules, path: string): boolean {
  const key = moduleForPath(path);
  return key ? moduleEnabled(org, key) : true;
}

/** Normalise a school's choice into the stored list. Core modules are always stored, so the list is never empty. */
export function normalizeModuleList(keys: string[]): string[] {
  const optional = OPTIONAL_MODULES.filter((k) => keys.includes(k));
  return [...CORE_MODULES, ...optional];
}

/** Optional modules that are on, in display order. */
export function enabledOptionalModules(org: OrgModules): OptionalModule[] {
  return OPTIONAL_MODULES.filter((k) => moduleEnabled(org, k));
}

export { isOptional as isOptionalModule };
