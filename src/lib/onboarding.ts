// Setup wizard steps and progress. Pure: safe for client and server.

export const SETUP_STEPS = ["profile", "year", "curricula", "modules", "people", "invite", "done"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
/** Steps that count towards progress (the last one is the summary). */
export const WORK_STEPS = SETUP_STEPS.filter((s) => s !== "done");

export const isSetupStep = (s: unknown): s is SetupStep => typeof s === "string" && (SETUP_STEPS as readonly string[]).includes(s);

export type StepState = "done" | "skipped" | "todo";

/** Organization.onboardingSteps holds "key" for a finished step and "skip:key" for a skipped one. */
export function stepState(steps: string[], key: SetupStep): StepState {
  if (steps.includes(key)) return "done";
  if (steps.includes(`skip:${key}`)) return "skipped";
  return "todo";
}

export function markStep(steps: string[], key: SetupStep, skipped: boolean): string[] {
  const rest = steps.filter((s) => s !== key && s !== `skip:${key}`);
  if (skipped && steps.includes(key)) return steps; // skipping a finished step keeps it finished
  return [...rest, skipped ? `skip:${key}` : key];
}

export function setupProgress(steps: string[]) {
  const done = WORK_STEPS.filter((k) => stepState(steps, k) === "done").length;
  const touched = WORK_STEPS.filter((k) => stepState(steps, k) !== "todo").length;
  const next = WORK_STEPS.find((k) => stepState(steps, k) === "todo") ?? "done";
  return { done, touched, total: WORK_STEPS.length, next: next as SetupStep, percent: Math.round((done / WORK_STEPS.length) * 100) };
}

export const nextStep = (key: SetupStep): SetupStep => SETUP_STEPS[Math.min(SETUP_STEPS.indexOf(key) + 1, SETUP_STEPS.length - 1)];
export const prevStep = (key: SetupStep): SetupStep | null => (SETUP_STEPS.indexOf(key) > 0 ? SETUP_STEPS[SETUP_STEPS.indexOf(key) - 1] : null);

/** Pages the access module owns; the wizard links to them. Set to false to hide those links. */
export const ACCESS_PAGES_LIVE = true;
export const ACCESS_PAGES = { invitations: "/admin/invitations", joinRequests: "/admin/join-requests", roles: "/admin/roles" } as const;

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const TIMEZONES = ["Asia/Dubai", "Asia/Muscat", "Asia/Riyadh", "Asia/Qatar", "Asia/Bahrain", "Asia/Kuwait"] as const;
