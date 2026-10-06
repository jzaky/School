// API key scopes: what a school API key may read or change, per area. Pure: shared by the admin page,
// the API and the tests. A scope is "<area>:read" or "<area>:write"; write includes read.

export const API_AREAS = ["students", "staff", "classes", "attendance"] as const;
export type ApiArea = (typeof API_AREAS)[number];

export type AccessLevel = "none" | "read" | "write";
export const ACCESS_LEVELS: AccessLevel[] = ["none", "read", "write"];

export type ScopeChoice = Partial<Record<ApiArea, AccessLevel>>;

export const isApiArea = (v: unknown): v is ApiArea => typeof v === "string" && (API_AREAS as readonly string[]).includes(v);

/** Scope strings for a set of choices, in a stable order. Unknown areas and "none" are dropped. */
export function scopesFromChoice(choice: ScopeChoice): string[] {
  const out: string[] = [];
  for (const area of API_AREAS) {
    const level = choice[area];
    if (level === "read" || level === "write") out.push(`${area}:${level}`);
  }
  return out;
}

/** The level a key has in one area. Unknown scope strings are ignored. */
export function levelOf(scopes: readonly string[], area: ApiArea): AccessLevel {
  if (scopes.includes(`${area}:write`)) return "write";
  if (scopes.includes(`${area}:read`)) return "read";
  return "none";
}

export function choiceFromScopes(scopes: readonly string[]): Record<ApiArea, AccessLevel> {
  return Object.fromEntries(API_AREAS.map((a) => [a, levelOf(scopes, a)])) as Record<ApiArea, AccessLevel>;
}

/** Whether the scopes allow reading (GET) or writing (POST) in an area. */
export function allows(scopes: readonly string[], area: ApiArea, need: "read" | "write"): boolean {
  const level = levelOf(scopes, area);
  return need === "read" ? level !== "none" : level === "write";
}

/** Only well-formed, known scopes survive. */
export function cleanScopes(scopes: readonly unknown[]): string[] {
  const choice: ScopeChoice = {};
  for (const s of scopes) {
    if (typeof s !== "string") continue;
    const [area, level] = s.split(":");
    if (!isApiArea(area) || (level !== "read" && level !== "write")) continue;
    if (choice[area] !== "write") choice[area] = level;
  }
  return scopesFromChoice(choice);
}

/** The API resource for a path segment, and the area that guards it. */
export const API_RESOURCES = {
  students: "students",
  staff: "staff",
  classes: "classes",
  enrollments: "classes",
  attendance: "attendance",
} as const satisfies Record<string, ApiArea>;
export type ApiResource = keyof typeof API_RESOURCES;
export const isApiResource = (v: unknown): v is ApiResource => typeof v === "string" && Object.prototype.hasOwnProperty.call(API_RESOURCES, v);
