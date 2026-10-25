// Where the platform is actually hosted, set per deployment (not per school), so the app never claims
// a data region it does not run in. HOSTING_REGION is a readable label (for example "EU West");
// DATA_RESIDENCY_UAE=true only when primary data really is stored in a UAE region.
export function hostingInfo(): { region: string | null; inUae: boolean } {
  const region = process.env.HOSTING_REGION?.trim() || null;
  return { region, inUae: !!region && process.env.DATA_RESIDENCY_UAE === "true" };
}
