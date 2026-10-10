import argon2 from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function passwordPolicyIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 12) issues.push("at least 12 characters");
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) issues.push("upper and lower case letters");
  if (!/[0-9]/.test(password)) issues.push("a digit");
  return issues;
}
