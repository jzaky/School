# Decisions

Ambiguities resolved during the build. Newest last.

## 2026-09-28 Starting state
- The instructions say `prisma/schema.prisma`, `prisma/rls.sql` and `src/lib/tenant-db.ts` were already built and tested. The repository was empty (no commits, no remote branches). These three files are built from scratch in Phase 1, together with the isolation suite that proves them.
- The master spec section of the instructions contains only the five reference repository URLs. docs/master-spec.md saves it verbatim. Where the build phases refer to "every service in the master spec", "the full form template library" and "every node type in the master spec", the lists are defined here from the hero flows, the overrides and common school operations, and are recorded below as they are decided.
- `[DATE]` in the deadline is a placeholder. Treated as "as soon as possible"; the production URL must work at every checkpoint.

## cal.diy license
- The cloned cal.diy repo carries an MIT LICENSE, but CLAUDE.md groups it with the GPL/AGPL repos. CLAUDE.md wins, so nothing from cal.diy is copied; slot logic is reimplemented.

## Routing and locale
- Product routes live under `src/app/(app)/[locale]/...` (`/en/...`, `/ar/...`). The marketing site lives under `src/app/(marketing)` at `/` and `/demo`, with the locale read from a cookie and a toggle that sets it. Two root layouts, one per route group.
