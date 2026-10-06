import { platformAdminEmails } from "./catalog-db";

/** A platform admin runs the hosted service (not a school role): User.isPlatformAdmin or PLATFORM_ADMIN_EMAILS. */
export function isPlatformAdmin(user: { email: string; isPlatformAdmin?: boolean | null }) {
  return Boolean(user.isPlatformAdmin) || platformAdminEmails().includes(user.email.toLowerCase());
}
