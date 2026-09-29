// Catalog rows a school sees: the shared global catalog (orgId null) plus its own additions.
// RLS already limits reads to these two sets; this filter states it explicitly so queries do not
// accidentally drop global rows with `where: { orgId }`.
export const catalogScope = (orgId: string) => ({ OR: [{ orgId }, { orgId: null }] });

/** Global catalog rows are maintained by the platform and are read-only for schools. */
export const isOwnRow = (row: { orgId: string | null }, orgId: string) => row.orgId === orgId;
