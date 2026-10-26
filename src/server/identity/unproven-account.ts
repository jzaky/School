// Accounts whose email address was never proven. Anyone can create a Horizon account with a password for any
// address (school sign-up, an application form, a join code) before proving they own it. When a school later
// gives that address access (adds the person, imports them, links a sign-on identity), the password set by an
// unproven owner must not come with it: it is removed and every session of the account ends, so the real owner
// sets their own password through the school's invitation or the password reset email.
import { identityDb } from "@/lib/tenant-db";

/**
 * Remove the password of an account whose email was never verified, and end its sessions. Returns true when a
 * password was removed. Safe to call for any account: verified accounts and accounts without a password are left
 * untouched.
 */
export async function releaseUnprovenPassword(userId: string, now = new Date()): Promise<boolean> {
  const res = await identityDb.user.updateMany({
    where: { id: userId, emailVerified: null, passwordHash: { not: null } },
    data: { passwordHash: null, sessionsValidFrom: now },
  });
  return res.count > 0;
}

/**
 * An outside identity provider vouched for the address: the account now belongs to whoever proved it. Any password
 * set before the address was proven is removed and older sessions end, then the address counts as verified.
 */
export async function claimByVerifiedProvider(userId: string, now = new Date()): Promise<void> {
  await releaseUnprovenPassword(userId, now);
  await identityDb.user.updateMany({ where: { id: userId, emailVerified: null }, data: { emailVerified: now } });
}
