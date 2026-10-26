// Keeps personal data out of server logs. Prisma's validation errors repeat the failing query's arguments (names,
// email addresses, dates of birth) in their message, and the framework prints uncaught errors in full. In
// production every console.error and console.warn passes through redactLogArg, which keeps only the first line of
// such an error ("Invalid `prisma.student.create()` invocation") and drops the rest.

const PRISMA_CALL = /Invalid `[^`]{1,120}` invocation/;
const WITHHELD = "(details withheld from logs)";

function prismaLike(e: { name?: unknown; message?: unknown }): boolean {
  const name = typeof e.name === "string" ? e.name : "";
  const message = typeof e.message === "string" ? e.message : "";
  return /^PrismaClient(Validation|Unknown|Rust|Initialization)/.test(name) || PRISMA_CALL.test(message);
}

/** One console argument with any Prisma query detail removed. Other values pass through unchanged. */
export function redactLogArg(a: unknown): unknown {
  if (a instanceof Error && prismaLike(a)) {
    const line = a.message.split("\n").find((l) => PRISMA_CALL.test(l))?.trim() ?? "";
    const e = new Error(`${line || a.name} ${WITHHELD}`);
    e.name = a.name;
    e.stack = `${e.name}: ${e.message}`;
    return e;
  }
  if (typeof a === "string" && PRISMA_CALL.test(a)) {
    return `${a.split("\n").find((l) => PRISMA_CALL.test(l))?.trim() ?? ""} ${WITHHELD}`;
  }
  return a;
}

let installed = false;

/** Route console.error and console.warn through the redaction (once per process). */
export function installLogRedaction() {
  if (installed) return;
  installed = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => original(...args.map(redactLogArg));
  }
}
