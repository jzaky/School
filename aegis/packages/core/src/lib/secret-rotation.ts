import { decryptSecret, encryptSecret, envelopeKeyId } from "./crypto.js";
import { currentDataKey } from "./keyring.js";

/**
 * Every column that stores a secret envelope, with the associated data each row was encrypted with.
 * The AAD here must match the code that writes and reads the column (identity/auth.ts, identity/oidc.ts,
 * integrations/service.ts, gateway/simulators.ts, integrations/destinations.ts); the test in
 * tests/keyring.test.ts writes through that code and re-encrypts here, so a mismatch fails it.
 */
export const SECRET_COLUMNS = [
  { table: "users", column: "mfa_secret_enc", select: "id, mfa_secret_enc AS v", aad: (r: Row) => `mfa:${r.id}` },
  { table: "sso_connections", column: "client_secret_enc", select: "id, org_id, client_secret_enc AS v", aad: (r: Row) => `sso:${r.org_id}` },
  { table: "integrations", column: "webhook_secret_enc", select: "id, key, webhook_secret_enc AS v", aad: (r: Row) => `integration:${r.key}` },
  { table: "credentials", column: "secret_enc", select: "id, name, secret_enc AS v", aad: (r: Row) => `credential:${r.id}:${r.name}` },
  { table: "event_destinations", column: "secret_envelope", select: "id, org_id, kind, secret_envelope AS v", aad: (r: Row) => `event-destination:${r.org_id}:${r.kind}` },
] as const;

type Row = { id: string; v: string | null; org_id?: string; key?: string; name?: string; kind?: string };

/** The owner-role client: re-encryption reads every organization's rows, so it runs as a platform script. */
export interface RawDb {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

export interface RotationReport {
  keyId: string;
  tables: { table: string; total: number; alreadyCurrent: number; rewritten: number; failed: number; failedIds: string[] }[];
}

/**
 * Re-encrypts every stored secret that is not yet under the current data key. Run it after adding a
 * new AEGIS_MASTER_KEY (with a new AEGIS_MASTER_KEY_ID) and moving the old one to
 * AEGIS_PREVIOUS_MASTER_KEYS; once it reports nothing left to rewrite, the previous key can be removed.
 * Each update only applies if the row still holds the envelope that was read, so a secret changed
 * meanwhile is left as written (already under the current key). A row no configured key can open is
 * counted as failed (with its id) and left untouched, and the run continues: the caller decides; the
 * operator script exits with an error, and the previous key must stay until failures are zero.
 * A dry run changes nothing.
 */
export async function reencryptStoredSecrets(db: RawDb, opts: { dryRun?: boolean } = {}): Promise<RotationReport> {
  const keyId = currentDataKey().id;
  const report: RotationReport = { keyId, tables: [] };
  for (const c of SECRET_COLUMNS) {
    const rows = await db.$queryRawUnsafe<Row[]>(`SELECT ${c.select} FROM ${c.table} WHERE ${c.column} IS NOT NULL`);
    let alreadyCurrent = 0;
    let rewritten = 0;
    const failedIds: string[] = [];
    for (const r of rows) {
      if (!r.v) continue;
      if (envelopeKeyId(r.v) === keyId) {
        alreadyCurrent++;
        continue;
      }
      const aad = c.aad(r);
      let next: string;
      try {
        next = encryptSecret(decryptSecret(r.v, aad), aad);
      } catch {
        failedIds.push(r.id);
        continue;
      }
      if (!opts.dryRun) {
        const n = await db.$executeRawUnsafe(`UPDATE ${c.table} SET ${c.column} = $1 WHERE id = $2::uuid AND ${c.column} = $3`, next, r.id, r.v);
        if (n === 1) rewritten++;
      } else {
        rewritten++;
      }
    }
    report.tables.push({ table: c.table, total: rows.length, alreadyCurrent, rewritten, failed: failedIds.length, failedIds: failedIds.slice(0, 20) });
  }
  return report;
}
