# Backup and recovery

## What must be backed up
1. PostgreSQL: all tenant data, the evidence chain and checkpoints. Daily base backup plus continuous WAL archiving (`pg_basebackup` or the managed provider's point-in-time recovery). Retention at least 35 days.
2. The evidence signing key and master key (`EVIDENCE_SIGNING_KEY`, `AEGIS_MASTER_KEY`): in the secret manager, with an offline copy under dual control. Losing the master key makes stored integration credentials, SSO secrets and MFA secrets unrecoverable (they can be re-entered; evidence is unaffected). Losing the signing key makes new checkpoints impossible until a new key is issued; old checkpoints still verify with the exported public key.
3. Audit document storage (`AEGIS_STORAGE_DIR` volume or object store): daily snapshot.
4. Exported evidence checkpoints: the worker signs one every five minutes; export `evidence_checkpoints` to customer-controlled storage (object lock) so a database rewrite is detectable.

## Recovery procedure
1. Restore PostgreSQL to the chosen point in time.
2. Run the migrate job against the restored database (idempotent; re-applies RLS and triggers).
3. Verify evidence integrity per organization: `POST /v1/assurance/evidence/verify` or the Platform Diagnostics screen. Compare the latest checkpoint hash with the externally stored copy.
4. Restore the document volume.
5. Start the worker first (it recovers stale jobs, expires overdue approvals and resumes checkpoints), then api and web.
6. Any approval that was pending at the time of the outage stays pending until its original expiry; nothing executes during the outage because the gateway was down (fail closed). Agents using the SDK saw deny results.

## Recovery objectives (targets, not yet measured in production)
RPO: 5 minutes with WAL archiving. RTO: 30 minutes for a single-region restore following the steps above.

## Tested
Exercised on 2026-10-11 in the development environment: `pg_dump -Fc` of the seeded database (0.78 MB), `pg_restore` into a fresh `aegis_test` database, the migrate job re-applied RLS and triggers, the 11-test isolation suite passed against the restored database, and `verifyChain` over the restored demo organization returned valid for all 1,772 evidence events. A production-grade drill with WAL archiving and point-in-time recovery has not been performed and is listed as remaining work.
