// One-time sealing of case notes written before field-level encryption: run by scripts/db-migrate.ts on every
// deploy (as the owner role, since the app role cannot change note versions). Idempotent: only rows that are still
// plain text are touched, and each update only applies if the row has not changed in between.
import { sealText } from "../../lib/sealed-text";

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;

// Same shape as src/lib/sealed-text.ts (Postgres regular expression).
const SEALED_SQL = "^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]*={0,2}$";

/** Encrypt every plain-text case note version. Returns how many rows were sealed, or null without a key. */
export async function sealLegacyCaseNotes(query: Query, opts: { batch?: number; env?: NodeJS.ProcessEnv } = {}): Promise<number | null> {
  const env = opts.env ?? process.env;
  if (!env.FIELD_ENCRYPTION_KEY) return null;
  const batch = opts.batch ?? 500;
  let sealed = 0;
  let after = "";
  for (;;) {
    const { rows } = await query(`SELECT id, body FROM "CaseNoteVersion" WHERE body !~ $1 AND id > $2 ORDER BY id LIMIT $3`, [SEALED_SQL, after, batch]);
    if (!rows.length) break;
    for (const r of rows) {
      const id = String(r.id);
      const body = String(r.body ?? "");
      const res = await query(`UPDATE "CaseNoteVersion" SET body = $1 WHERE id = $2 AND body = $3`, [sealText(body), id, body]);
      sealed += res.rowCount ?? 0;
      after = id;
    }
  }
  return sealed;
}
