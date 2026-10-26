// Authorization sweep: lists every server action (exports of "use server" modules) and every route handler
// under src/app, and reports any that never reach a context, permission, API key or signature check.
//
//   npx tsx scripts/authz-sweep.ts            summary plus anything unguarded (exit 1 when there is any)
//   npx tsx scripts/authz-sweep.ts --all      every entry point with its classification
//   npx tsx scripts/authz-sweep.ts --json     machine-readable output
//
// Classification of each entry point (transitively through helpers in this code base):
//   permission  reaches requirePermission, ctx.can, a platform or group role check, or an API key check
//   context     reaches getCtx (a signed-in, active member) but no permission check; review the object checks
//   public      listed in PUBLIC below with the reason it is open on purpose
//   none        reaches none of the above: a finding unless it is added to PUBLIC with a reason
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(process.argv.find((a) => a.startsWith("--root="))?.slice(7) ?? ".");
const SRC = path.join(ROOT, "src");

/** Calls that establish who the caller is (a signed-in, active member or a verified machine caller). */
const CONTEXT_ROOTS = new Set(["getCtx", "getOptionalCtx", "auth", "loadContext"]);
/** Calls that check what the caller may do. */
const PERMISSION_ROOTS = new Set([
  "requirePermission",
  "requirePlatformAdmin",
  "isPlatformAdmin",
  "requireGroupRole",
  "groupRolesForUser",
  "isPlatformAdminEmail",
  "getGroupCtx",
  "authenticateApiKey",
  "verifyWebhook",
  "handlePaymentWebhook",
]);
/** Method calls that are permission checks (ctx.can("x"), access.canView(...)). */
const PERMISSION_METHODS = new Set(["can"]);

/**
 * Entry points that are open on purpose, with the reason. Each one must do its own checks (rate limits, signed
 * tokens, codes); the sweep only records that a person reviewed it.
 */
const PUBLIC: Record<string, string> = {
  "src/server/access/join-actions.ts#checkJoinCodeAction": "Join code check: rate limited per network address, reveals only the school's public name",
  "src/server/access/join-actions.ts#continueWithProviderAction": "Remembers a join page (allowlisted path) before Google or Microsoft sign-in",
  "src/server/access/join-actions.ts#signOutToJoinAction": "Signs out and returns to a join page (allowlisted path)",
  "src/server/admissions/apply-actions.ts#*": "Public admissions application: rate limited, applicant session is a signed cookie, every action limited to the family's own applications",
  "src/server/marketing/actions.ts#*": "Marketing lead and taster forms: honeypot, rate limited per address and email, no school data returned",
  "src/server/onboarding/signup-actions.ts#*": "School sign-up before an account exists: rate limited per address and email, creates a new school only",
  "src/server/shell/actions.ts#setMarketingLocaleAction": "Sets the language cookie",
  "src/server/shell/actions.ts#signInAsPersonaAction": "Demo persona sign-in: only when DEMO_MODE=true and only into the demonstration school",
  "src/server/shell/actions.ts#signInWithPasswordAction": "Password sign-in: rate limited per email and network address, one generic error",
  "src/server/shell/actions.ts#signInWithProviderAction": "Starts Google or Microsoft sign-in",
  "src/server/shell/actions.ts#signOutAction": "Signs out (the session id is recorded as ended)",
  "src/server/sso/actions.ts#findSchoolAction": "Finds a school's sign-in page by its public address name",
  "src/server/sso/actions.ts#rememberSchoolAction": "Remembers the school chosen on the sign-in page (a hint only, validated name)",
  "src/server/sso/actions.ts#requestMagicLinkAction": "Email sign-in link request: rate limited, same answer and timing for every address",
  "src/server/sso/actions.ts#requestPasswordResetAction": "Password reset request: rate limited, same answer and timing for every address",
  "src/server/sso/actions.ts#resetPasswordAction": "Password reset with a single-use, time-limited token, rate limited",
  "src/server/sso/actions.ts#redeemMagicLinkAction": "Uses a single-use, 15 minute sign-in link, rate limited",
  "src/app/api/auth/[...nextauth]/route.ts#*": "Auth.js sign-in endpoints",
  "src/app/api/health/route.ts#*": "Health check: no data",
  "src/app/api/v1/[resource]/route.ts#PUT": "Answers 405",
  "src/app/api/v1/[resource]/route.ts#PATCH": "Answers 405",
  "src/app/api/v1/[resource]/route.ts#DELETE": "Answers 405",
  "src/app/api/v1/openapi.json/route.ts#*": "API description: no data",
  "src/app/api/v1/samples/[file]/route.ts#*": "Sample CSV templates: fixed files, no data",
  "src/app/api/sso/[provider]/start/route.ts#*": "Single sign-on start: redirects to the identity provider, return path allowlisted",
  "src/app/api/sso/[provider]/callback/route.ts#*": "Single sign-on callback: sealed state, nonce and PKCE checked before any account is touched",
  "src/app/api/admissions/apply/[slug]/logo/route.ts#*": "School logo on the public application page",
  "src/app/api/admissions/apply/[slug]/upload/route.ts#*": "Applicant document upload: verified applicant session, own application only, rate limited, checked by content",
  "src/app/(marketing)/try/result/[token]/pdf/route.ts#*": "Free taster result: unguessable token, no school data",
  "src/app/app/route.ts#*": "Redirects to the product",
  "src/app/choose/[code]/route.ts#*": "Class session short link: redirects to a fixed product path",
};

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

type Fn = { file: string; name: string; node: ts.Node; calls: Set<string>; methodCalls: Set<string> };
type Level = "permission" | "context" | "none";

function walk(dir: string, acc: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const files = walk(SRC);
const fns = new Map<string, Fn>(); // key: file#name
const imports = new Map<string, Map<string, { file: string; name: string }>>(); // file -> local name -> target
const exportsOf = new Map<string, Map<string, string>>(); // file -> exported name -> local name
const useServer = new Set<string>();

function collectCalls(node: ts.Node, calls: Set<string>, methodCalls: Set<string>) {
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) calls.add(e.text);
      else if (ts.isPropertyAccessExpression(e)) {
        methodCalls.add(e.name.text);
        // Namespace style calls (mod.fn()) resolve by the property name.
        calls.add(e.name.text);
      }
      // Functions passed by reference (cache(fn), withX(fn), arr.map(fn)).
      for (const a of n.arguments) if (ts.isIdentifier(a)) calls.add(a.text);
    }
    if (ts.isTaggedTemplateExpression(n) && ts.isIdentifier(n.tag)) calls.add(n.tag.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const first = sf.statements[0];
  if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server") useServer.add(file);
  const imp = new Map<string, { file: string; name: string }>();
  const exp = new Map<string, string>();
  imports.set(file, imp);
  exportsOf.set(file, exp);
  const addFn = (name: string, node: ts.Node) => {
    const calls = new Set<string>();
    const methodCalls = new Set<string>();
    collectCalls(node, calls, methodCalls);
    fns.set(`${file}#${name}`, { file, name, node, calls, methodCalls });
  };
  const isExported = (n: ts.Node) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const target = resolveImport(file, st.moduleSpecifier.text);
      const named = st.importClause?.namedBindings;
      if (target && named && ts.isNamedImports(named)) {
        for (const el of named.elements) imp.set(el.name.text, { file: target, name: (el.propertyName ?? el.name).text });
      }
      if (target && st.importClause?.name) imp.set(st.importClause.name.text, { file: target, name: "default" });
      if (target && named && ts.isNamespaceImport(named)) imp.set(named.name.text, { file: target, name: "*" });
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      addFn(st.name.text, st);
      if (isExported(st)) exp.set(st.name.text, st.name.text);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) {
          addFn(d.name.text, d.initializer);
          if (isExported(st)) exp.set(d.name.text, d.name.text);
        } else if (ts.isObjectBindingPattern(d.name) && d.initializer) {
          // export const { GET, POST } = handlers;
          for (const el of d.name.elements) {
            if (!ts.isIdentifier(el.name)) continue;
            addFn(el.name.text, d.initializer);
            if (isExported(st)) exp.set(el.name.text, el.name.text);
          }
        }
      }
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const local = (el.propertyName ?? el.name).text;
        if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
          const target = resolveImport(file, st.moduleSpecifier.text);
          if (target) imp.set(local, { file: target, name: local });
        }
        exp.set(el.name.text, local);
      }
    } else if (ts.isClassDeclaration(st) && st.name) {
      addFn(st.name.text, st);
    }
  }
}

// Fixpoint: a function's level is the best level reachable through the functions it calls.
const level = new Map<string, Level>();
const rank: Record<Level, number> = { none: 0, context: 1, permission: 2 };

function targetKey(file: string, name: string): string | null {
  if (fns.has(`${file}#${name}`)) return `${file}#${name}`;
  const im = imports.get(file)?.get(name);
  if (im && im.name !== "*" && im.name !== "default") {
    const local = exportsOf.get(im.file)?.get(im.name) ?? im.name;
    return targetKey(im.file, local === im.name ? im.name : local) ?? (fns.has(`${im.file}#${local}`) ? `${im.file}#${local}` : null);
  }
  return null;
}

for (const [key, f] of fns) {
  let l: Level = "none";
  for (const c of f.calls) if (CONTEXT_ROOTS.has(c)) l = "context";
  for (const c of f.calls) if (PERMISSION_ROOTS.has(c)) l = "permission";
  for (const m of f.methodCalls) if (PERMISSION_METHODS.has(m)) l = "permission";
  level.set(key, l);
}
for (let changed = true, guard = 0; changed && guard < 50; guard++) {
  changed = false;
  for (const [key, f] of fns) {
    let best = level.get(key)!;
    for (const c of f.calls) {
      const t = targetKey(f.file, c);
      if (!t || t === key) continue;
      const tl = level.get(t) ?? "none";
      if (rank[tl] > rank[best]) best = tl;
    }
    if (best !== level.get(key)) {
      level.set(key, best);
      changed = true;
    }
  }
}

type Entry = { kind: "action" | "route"; file: string; name: string; level: Level | "public"; reason?: string };
const entries: Entry[] = [];

function publicReason(file: string, name: string) {
  return PUBLIC[`${rel(file)}#${name}`] ?? PUBLIC[`${rel(file)}#*`];
}

for (const file of useServer) {
  for (const [exported, local] of exportsOf.get(file) ?? []) {
    const key = targetKey(file, local);
    const l = key ? (level.get(key) ?? "none") : "none";
    const reason = publicReason(file, exported);
    entries.push({ kind: "action", file: rel(file), name: exported, level: l === "none" && reason ? "public" : l, reason });
  }
}

for (const file of files.filter((f) => /[/\\]route\.tsx?$/.test(f) && f.startsWith(path.join(SRC, "app")))) {
  for (const [exported, local] of exportsOf.get(file) ?? []) {
    if (!HTTP_METHODS.has(exported)) continue;
    const key = targetKey(file, local);
    let l: Level = key ? (level.get(key) ?? "none") : "none";
    // Re-exported handlers (export { GET, POST } from Auth.js) count as their source.
    if (!key && imports.get(file)?.get(local)) l = "none";
    const reason = publicReason(file, exported);
    entries.push({ kind: "route", file: rel(file), name: exported, level: l === "none" && reason ? "public" : l, reason });
  }
}

entries.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
const unguarded = entries.filter((e) => e.level === "none");
const stalePublic = Object.keys(PUBLIC).filter((k) => {
  const [f, n] = k.split("#");
  return !entries.some((e) => e.file === f && (n === "*" || e.name === n));
});

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ entries, unguarded, stalePublic }, null, 2));
} else {
  const count = (k: Entry["kind"], l: Entry["level"]) => entries.filter((e) => e.kind === k && e.level === l).length;
  console.log(`Server actions: ${entries.filter((e) => e.kind === "action").length} (permission ${count("action", "permission")}, context ${count("action", "context")}, public ${count("action", "public")}, none ${count("action", "none")})`);
  console.log(`Route handlers: ${entries.filter((e) => e.kind === "route").length} (permission ${count("route", "permission")}, context ${count("route", "context")}, public ${count("route", "public")}, none ${count("route", "none")})`);
  if (process.argv.includes("--all")) for (const e of entries) console.log(`${e.level.padEnd(10)} ${e.kind.padEnd(6)} ${e.file}#${e.name}${e.reason ? `  (${e.reason})` : ""}`);
  else if (process.argv.includes("--context")) for (const e of entries.filter((x) => x.level === "context")) console.log(`context    ${e.kind.padEnd(6)} ${e.file}#${e.name}`);
  for (const e of unguarded) console.log(`UNGUARDED  ${e.kind.padEnd(6)} ${e.file}#${e.name}`);
  for (const k of stalePublic) console.log(`STALE PUBLIC ENTRY ${k}`);
}
process.exit(unguarded.length || stalePublic.length ? 1 : 0);
