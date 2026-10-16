/**
 * Data key operations for operators. Never prints a plain data key unless asked with --show-new-key.
 *
 *   tsx scripts/data-key.ts wrap-current --provider aws-kms|azure-keyvault
 *     Wraps the data key currently in AEGIS_MASTER_KEY (env provider) with the vault and prints the
 *     wrapped value. Switching on the vault is then: set AEGIS_KEY_PROVIDER, set AEGIS_MASTER_KEY to the
 *     wrapped value, keep AEGIS_MASTER_KEY_ID. No stored secret changes, because the data key is the same.
 *
 *   tsx scripts/data-key.ts new --provider env|aws-kms|azure-keyvault [--show-new-key]
 *     Creates a new random data key for a rotation and prints it wrapped by the vault (or, for env,
 *     only with --show-new-key). Then: new AEGIS_MASTER_KEY + new AEGIS_MASTER_KEY_ID, old ones in
 *     AEGIS_PREVIOUS_MASTER_KEYS, restart, run rotate.
 *
 *   tsx scripts/data-key.ts rotate [--dry-run]
 *     Re-encrypts every stored secret under the current data key (needs MIGRATION_DATABASE_URL, the
 *     owner role, because it reads every organization). Prints counts per table, never values.
 */
import { randomBytes } from "node:crypto";
import { disconnectAll, ownerPrisma } from "@aegis/db";
import { env } from "../src/env.js";
import { initKeyring, loadProvider, type KeyProviderName } from "../src/lib/keyring.js";
import { reencryptStoredSecrets } from "../src/lib/secret-rotation.js";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(name);
const opt = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function main() {
  if (cmd === "wrap-current") {
    const provider = opt("--provider") as KeyProviderName | undefined;
    if (provider !== "aws-kms" && provider !== "azure-keyvault") throw new Error("--provider aws-kms or azure-keyvault");
    if (env().AEGIS_KEY_PROVIDER !== "env") throw new Error("AEGIS_MASTER_KEY is already wrapped (AEGIS_KEY_PROVIDER is not env)");
    const dataKey = Buffer.from(env().AEGIS_MASTER_KEY, "base64");
    if (dataKey.length !== 32) throw new Error("AEGIS_MASTER_KEY must decode to 32 bytes");
    const wrapped = await (await loadProvider(provider)).wrap(dataKey);
    const check = await (await loadProvider(provider)).unwrap(wrapped);
    if (!check.equals(dataKey)) throw new Error("The vault did not return the same key on unwrap; nothing changed");
    console.log(`AEGIS_KEY_PROVIDER=${provider}`);
    console.log(`AEGIS_MASTER_KEY=${wrapped.toString("base64")}`);
    console.log(`AEGIS_MASTER_KEY_ID=${env().AEGIS_MASTER_KEY_ID}`);
    return;
  }
  if (cmd === "new") {
    const provider = (opt("--provider") ?? "env") as KeyProviderName;
    const dataKey = randomBytes(32);
    if (provider === "env") {
      if (!flag("--show-new-key")) throw new Error("With the env provider the new key is shown in plain text: pass --show-new-key to confirm");
      console.log(`AEGIS_MASTER_KEY=${dataKey.toString("base64")}`);
    } else {
      console.log(`AEGIS_MASTER_KEY=${(await (await loadProvider(provider)).wrap(dataKey)).toString("base64")}`);
    }
    console.log("Choose a new AEGIS_MASTER_KEY_ID and move the current id:value into AEGIS_PREVIOUS_MASTER_KEYS.");
    return;
  }
  if (cmd === "rotate") {
    if (!env().MIGRATION_DATABASE_URL) throw new Error("rotate reads every organization's secrets and needs MIGRATION_DATABASE_URL (owner role)");
    await initKeyring();
    const db = ownerPrisma();
    try {
      const report = await reencryptStoredSecrets(db, { dryRun: flag("--dry-run") });
      console.log(`Current key: ${report.keyId}${flag("--dry-run") ? " (dry run, nothing written)" : ""}`);
      for (const t of report.tables) console.log(`${t.table}: ${t.total} stored, ${t.alreadyCurrent} already current, ${t.rewritten} re-encrypted, ${t.failed} could not be opened${t.failed ? ` (ids: ${t.failedIds.join(", ")})` : ""}`);
      if (report.tables.some((t) => t.failed > 0)) {
        console.error("Some secrets could not be opened with any configured key. Keep the previous keys and investigate before removing them.");
        process.exitCode = 1;
      }
    } finally {
      await disconnectAll();
    }
    return;
  }
  throw new Error("Usage: data-key.ts wrap-current|new|rotate (see the comment at the top of this file)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
