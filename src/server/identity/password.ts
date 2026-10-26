// Password checks that take the same time whether or not the account exists or has a password, so the response
// time of a sign-in form does not reveal which email addresses have accounts.
import bcrypt from "bcryptjs";

// A bcrypt hash of a random value nobody knows, at the cost used for real passwords (10 to 12 rounds).
const DUMMY_HASH = "$2b$12$Lc1/lEIYTsGxWnEt0YeGzerw0LC.eWYhTE5eO4v00fqDbyCX1V1Xi";

/** True only when `hash` is set and matches. Spends the same work when there is no hash. */
export async function passwordMatches(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH).catch(() => false);
    return false;
  }
  return bcrypt.compare(password, hash);
}
