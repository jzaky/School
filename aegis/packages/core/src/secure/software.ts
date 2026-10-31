import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Prisma, SoftwareComponent, SoftwareFinding, SoftwareItem, TenantDb } from "@aegis/db";
import { z } from "zod";
import { env } from "../env.js";
import { appendEvidence } from "../evidence/ledger.js";
import { pinnedLookup } from "../integrations/destinations.js";
import type { OrgContext } from "../lib/context.js";
import { forbidden, notFound, validation } from "../lib/errors.js";
import { orgSettings } from "../lib/tx-cache.js";
import { assertPermission } from "../orgs/orgs.js";
import { evaluatePolicies, type PolicyToEvaluate } from "../policy/evaluate.js";
import type { PolicyDocument } from "../policy/schema.js";
import { policyIntegrityFailures } from "../policy/service.js";
import { createSecurityEvent } from "../shield/security-events.js";
import { normalizePlan, planIncludes } from "../commercial/plans.js";

/**
 * Open-source and third-party software security (docs/SOFTWARE_SECURITY.md).
 *
 * Someone asks to use a piece of software. AEGIS takes its software bill of materials (CycloneDX, SPDX or an
 * npm lockfile, as produced by Syft, Trivy or npm) and scanner reports (Grype, Trivy, Gitleaks, OpenSSF
 * Scorecard), optionally asks OSV.dev about known vulnerabilities, runs its own deterministic checks
 * (typosquatting, dependency confusion, install scripts, integrity, licenses), and turns everything into an
 * explained risk assessment. The organization's software policy, evaluated by the one policy engine, and a
 * built-in floor produce a recommended status; a person other than the requester makes the decision.
 *
 * A clean assessment means no known problem was found by these checks. It never means the software is safe.
 */

export const SOFTWARE_STATUSES = ["under_review", "approved", "restricted", "quarantined", "prohibited"] as const;
export type SoftwareStatus = (typeof SOFTWARE_STATUSES)[number];
const STATUS_RANK: Record<SoftwareStatus, number> = { approved: 0, restricted: 1, under_review: 2, quarantined: 3, prohibited: 4 };
export const SOFTWARE_CATEGORY = "software";
export const ECOSYSTEMS = ["npm", "pypi", "maven", "go", "nuget", "cargo", "container", "application", "browser_extension", "other"] as const;

// ---------- parsed shapes ----------

export interface ParsedComponent {
  name: string;
  version: string;
  ecosystem: string;
  purl: string | null;
  licenses: string[];
  resolvedHost: string | null;
  hasIntegrity: boolean | null;
  hasInstallScript: boolean | null;
  direct: boolean;
}

export interface ParsedFinding {
  kind: "vulnerability" | "malicious" | "secret" | "maintenance";
  severity: "critical" | "high" | "medium" | "low";
  ref: string;
  component: string;
  title: string;
  source: string;
  fixedIn: string | null;
}

const get = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw validation("The file is not valid JSON");
  }
}

function ecoFromPurl(purl: string): string {
  const t = /^pkg:([a-z0-9.+-]+)\//i.exec(purl)?.[1]?.toLowerCase() ?? "";
  return ({ npm: "npm", pypi: "pypi", maven: "maven", golang: "go", nuget: "nuget", cargo: "cargo", docker: "container", oci: "container" } as Record<string, string>)[t] ?? (t || "");
}

export function normalizeSeverity(raw: string): ParsedFinding["severity"] {
  const s = raw.toLowerCase();
  if (s.startsWith("crit")) return "critical";
  if (s.startsWith("high")) return "high";
  if (s.startsWith("med") || s.startsWith("mod")) return "medium";
  return "low";
}

/** CycloneDX JSON (Syft, Trivy, cdxgen and others). */
export function parseCycloneDx(text: string): ParsedComponent[] {
  const doc = parseJson(text);
  if (get(doc, "bomFormat") !== "CycloneDX") throw validation("Not a CycloneDX JSON document (bomFormat is missing)");
  return arr(get(doc, "components")).map((c) => {
    const purl = str(get(c, "purl")) || null;
    const group = str(get(c, "group"));
    const licenses = arr(get(c, "licenses"))
      .map((l) => str(get(get(l, "license"), "id")) || str(get(get(l, "license"), "name")) || str(get(l, "expression")))
      .filter(Boolean);
    return { name: group ? `${group}/${str(get(c, "name"))}` : str(get(c, "name")), version: str(get(c, "version")), ecosystem: purl ? ecoFromPurl(purl) : "", purl, licenses, resolvedHost: null, hasIntegrity: arr(get(c, "hashes")).length ? true : null, hasInstallScript: null, direct: false };
  }).filter((c) => c.name);
}

/** SPDX 2.x JSON. */
export function parseSpdx(text: string): ParsedComponent[] {
  const doc = parseJson(text);
  if (!str(get(doc, "spdxVersion"))) throw validation("Not an SPDX JSON document (spdxVersion is missing)");
  return arr(get(doc, "packages")).map((p) => {
    const purl = str(get(arr(get(p, "externalRefs")).find((r) => get(r, "referenceType") === "purl"), "referenceLocator")) || null;
    const lic = [str(get(p, "licenseConcluded")), str(get(p, "licenseDeclared"))].find((l) => l && l !== "NOASSERTION" && l !== "NONE");
    return { name: str(get(p, "name")), version: str(get(p, "versionInfo")), ecosystem: purl ? ecoFromPurl(purl) : "", purl, licenses: lic ? [lic] : [], resolvedHost: null, hasIntegrity: arr(get(p, "checksums")).length ? true : null, hasInstallScript: null, direct: false };
  }).filter((c) => c.name);
}

/** npm package-lock.json, lockfile version 2 or 3: includes where each package came from and whether it runs install scripts. */
export function parseNpmLock(text: string): ParsedComponent[] {
  const doc = parseJson(text);
  const pkgs = get(doc, "packages");
  if (!pkgs || typeof pkgs !== "object") throw validation("Only lockfile version 2 or 3 is supported (it has a packages map)");
  const rootDeps = new Set([...Object.keys((get(get(pkgs, ""), "dependencies") as object) ?? {}), ...Object.keys((get(get(pkgs, ""), "devDependencies") as object) ?? {})]);
  const out: ParsedComponent[] = [];
  for (const [path, p] of Object.entries(pkgs as Record<string, unknown>)) {
    if (!path) continue;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const resolved = str(get(p, "resolved"));
    let host: string | null = null;
    try {
      host = resolved ? new URL(resolved).hostname : null;
    } catch {
      host = null;
    }
    const lic = str(get(p, "license"));
    out.push({ name, version: str(get(p, "version")), ecosystem: "npm", purl: `pkg:npm/${name.replaceAll("@", "%40")}@${str(get(p, "version"))}`, licenses: lic ? [lic] : [], resolvedHost: host, hasIntegrity: resolved ? !!str(get(p, "integrity")) : null, hasInstallScript: get(p, "hasInstallScript") === true, direct: path === `node_modules/${name}` && rootDeps.has(name) });
  }
  return out;
}

/** Grype JSON output (grype -o json). */
export function parseGrype(text: string): ParsedFinding[] {
  const doc = parseJson(text);
  return arr(get(doc, "matches")).map((m) => {
    const v = get(m, "vulnerability");
    const a = get(m, "artifact");
    const fixed = arr(get(get(v, "fix"), "versions")).map(str).filter(Boolean);
    return { kind: "vulnerability" as const, severity: normalizeSeverity(str(get(v, "severity"))), ref: str(get(v, "id")), component: `${str(get(a, "name"))}@${str(get(a, "version"))}`, title: (str(get(v, "description")) || str(get(v, "id"))).slice(0, 300), source: "grype", fixedIn: fixed[0] ?? null };
  }).filter((f) => f.ref);
}

/** Trivy JSON output (trivy ... -f json): vulnerabilities and secrets. Secret values and matched lines are dropped. */
export function parseTrivy(text: string): ParsedFinding[] {
  const doc = parseJson(text);
  const out: ParsedFinding[] = [];
  for (const r of arr(get(doc, "Results"))) {
    for (const v of arr(get(r, "Vulnerabilities"))) out.push({ kind: "vulnerability", severity: normalizeSeverity(str(get(v, "Severity"))), ref: str(get(v, "VulnerabilityID")), component: `${str(get(v, "PkgName"))}@${str(get(v, "InstalledVersion"))}`, title: (str(get(v, "Title")) || str(get(v, "VulnerabilityID"))).slice(0, 300), source: "trivy", fixedIn: str(get(v, "FixedVersion")) || null });
    for (const s of arr(get(r, "Secrets"))) out.push({ kind: "secret", severity: normalizeSeverity(str(get(s, "Severity")) || "high"), ref: str(get(s, "RuleID")), component: str(get(r, "Target")), title: `Secret found: ${str(get(s, "Title")) || str(get(s, "RuleID"))}`, source: "trivy", fixedIn: null });
  }
  return out.filter((f) => f.ref);
}

/** Gitleaks JSON report. Only the rule and file are kept; the secret and the matched text never are. */
export function parseGitleaks(text: string): ParsedFinding[] {
  const doc = parseJson(text);
  if (!Array.isArray(doc)) throw validation("Expected the Gitleaks JSON report (an array)");
  return doc.map((f) => ({ kind: "secret" as const, severity: "high" as const, ref: str(get(f, "RuleID")), component: `${str(get(f, "File"))}:${String(get(f, "StartLine") ?? "")}`, title: `Secret found: ${str(get(f, "Description")) || str(get(f, "RuleID"))}`, source: "gitleaks", fixedIn: null })).filter((f) => f.ref);
}

/** OpenSSF Scorecard JSON. Low scores become maintenance findings; the overall score is kept for the assessment. */
export function parseScorecard(text: string): { score: number | null; findings: ParsedFinding[] } {
  const doc = parseJson(text);
  const score = typeof get(doc, "score") === "number" ? (get(doc, "score") as number) : null;
  const repo = str(get(get(doc, "repo"), "name"));
  const findings: ParsedFinding[] = [];
  for (const c of arr(get(doc, "checks"))) {
    const s = get(c, "score");
    if (typeof s !== "number" || s < 0) continue;
    const name = str(get(c, "name"));
    if (s <= 3 && ["Maintained", "Code-Review", "Branch-Protection", "Signed-Releases", "Dangerous-Workflow", "Token-Permissions", "Vulnerabilities", "Pinned-Dependencies"].includes(name)) {
      findings.push({ kind: "maintenance", severity: name === "Dangerous-Workflow" || name === "Maintained" ? "medium" : "low", ref: `scorecard:${name}`, component: repo, title: `OpenSSF Scorecard ${name}: ${s}/10. ${str(get(c, "reason"))}`.slice(0, 300), source: "scorecard", fixedIn: null });
    }
  }
  return { score, findings };
}

// ---------- local checks ----------

/** A short list of very widely used packages per ecosystem, for typosquatting checks. Not exhaustive. */
export const POPULAR_PACKAGES: Record<string, string[]> = {
  npm: ["react", "react-dom", "lodash", "express", "axios", "chalk", "commander", "debug", "moment", "request", "typescript", "webpack", "vue", "next", "jquery", "uuid", "dotenv", "cross-env", "eslint", "prettier", "jest", "mocha", "underscore", "async", "bluebird", "yargs", "minimist", "body-parser", "cors", "mongoose", "redis", "pg", "mysql", "socket.io", "ws", "node-fetch", "colors", "rimraf", "glob", "semver", "fs-extra", "zod", "prisma", "electron", "babel-core", "openai", "langchain"],
  pypi: ["requests", "numpy", "pandas", "urllib3", "setuptools", "boto3", "botocore", "six", "python-dateutil", "pyyaml", "certifi", "idna", "charset-normalizer", "cryptography", "django", "flask", "jinja2", "pytest", "scipy", "matplotlib", "pillow", "sqlalchemy", "beautifulsoup4", "selenium", "tensorflow", "torch", "scikit-learn", "openai", "anthropic", "langchain", "transformers", "colorama", "pydantic", "fastapi", "aiohttp"],
};

/** Damerau-Levenshtein distance (optimal string alignment), small inputs only. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

/** The popular package a name imitates, if it is one edit away (or differs only by separators) and is not itself popular. */
export function typosquatTarget(name: string, ecosystem: string): string | null {
  const list = POPULAR_PACKAGES[ecosystem];
  if (!list) return null;
  const n = name.toLowerCase().replace(/^@[^/]+\//, "");
  if (list.includes(n) || list.includes(name.toLowerCase())) return null;
  const squash = (s: string) => s.replace(/[-_.]/g, "");
  for (const p of list) {
    if (n.length < 4) continue;
    if (squash(n) === squash(p) || editDistance(n, p) === 1) return p;
  }
  return null;
}

export interface SoftwarePolicySettings {
  /** Package name prefixes that belong to the organization (for example "@meridian/" or "mgb-"). */
  internalPrefixes: string[];
  /** Registry hosts that serve internal packages. A package with an internal name resolved anywhere else is suspicious. */
  internalHosts: string[];
  licenses: { allowed: string[]; review: string[]; prohibited: string[] };
  /** Ask OSV.dev about public packages. Sends package names and versions to osv.dev; internal names are never sent. */
  osvLookup: boolean;
  /** Approve automatically when the recommendation is approved. Off by default: a person decides. */
  autoApprove: boolean;
}

export const DEFAULT_SOFTWARE_SETTINGS: SoftwarePolicySettings = {
  internalPrefixes: [],
  internalHosts: [],
  licenses: {
    allowed: ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "CC0-1.0", "Zlib", "BlueOak-1.0.0", "Python-2.0", "PSF-2.0"],
    review: ["MPL-2.0", "LGPL-2.1", "LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-3.0", "LGPL-3.0-only", "LGPL-3.0-or-later", "EPL-2.0", "CDDL-1.0", "CC-BY-4.0"],
    prohibited: ["GPL-2.0", "GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0", "GPL-3.0-only", "GPL-3.0-or-later", "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later", "SSPL-1.0", "BUSL-1.1", "Elastic-2.0", "Commons-Clause"],
  },
  osvLookup: false,
  autoApprove: false,
};

export function readSoftwareSettings(settings: unknown): SoftwarePolicySettings {
  const s = ((settings ?? {}) as { software?: Partial<SoftwarePolicySettings> }).software ?? {};
  const l = s.licenses ?? DEFAULT_SOFTWARE_SETTINGS.licenses;
  return {
    internalPrefixes: Array.isArray(s.internalPrefixes) ? s.internalPrefixes.filter((x): x is string => typeof x === "string") : [],
    internalHosts: Array.isArray(s.internalHosts) ? s.internalHosts.filter((x): x is string => typeof x === "string") : [],
    licenses: { allowed: l.allowed ?? DEFAULT_SOFTWARE_SETTINGS.licenses.allowed, review: l.review ?? DEFAULT_SOFTWARE_SETTINGS.licenses.review, prohibited: l.prohibited ?? DEFAULT_SOFTWARE_SETTINGS.licenses.prohibited },
    osvLookup: s.osvLookup === true,
    autoApprove: s.autoApprove === true,
  };
}

/** Classifies an SPDX license or expression. "OR" takes the most permissive option, "AND" the strictest. */
export function classifyLicense(expr: string, policy: SoftwarePolicySettings["licenses"]): "allowed" | "review" | "prohibited" | "unknown" {
  const rank = { allowed: 0, review: 1, unknown: 2, prohibited: 3 } as const;
  const one = (id: string): keyof typeof rank => {
    const t = id.replace(/[()]/g, "").trim();
    if (policy.prohibited.some((p) => p.toLowerCase() === t.toLowerCase())) return "prohibited";
    if (policy.allowed.some((p) => p.toLowerCase() === t.toLowerCase())) return "allowed";
    if (policy.review.some((p) => p.toLowerCase() === t.toLowerCase())) return "review";
    return "unknown";
  };
  // Tokenised on whitespace, then grouped: OR alternatives of AND conjunctions (linear, no backtracking).
  const groups: string[][][] = [[[]]];
  for (const tok of expr.trim().split(/\s+/)) {
    const up = tok.toUpperCase();
    if (up === "OR") groups.push([[]]);
    else if (up === "AND") groups[groups.length - 1]!.push([]);
    else groups[groups.length - 1]!.at(-1)!.push(tok);
  }
  const ors = groups.map((ands) => ands.map((t) => one(t.join(" "))).reduce((a, b) => (rank[a] >= rank[b] ? a : b)));
  return ors.reduce((a, b) => (rank[a] <= rank[b] ? a : b));
}

export function isInternalName(name: string, s: SoftwarePolicySettings) {
  return s.internalPrefixes.some((p) => p && name.toLowerCase().startsWith(p.toLowerCase()));
}

/** Deterministic checks on the component list. */
export function localChecks(components: ParsedComponent[], s: SoftwarePolicySettings, itemEcosystem: string): { kind: SoftwareFinding["kind"]; severity: ParsedFinding["severity"]; ref: string; component: string; title: string }[] {
  const out: ReturnType<typeof localChecks> = [];
  for (const c of components) {
    const id = c.version ? `${c.name}@${c.version}` : c.name;
    const eco = c.ecosystem || itemEcosystem;
    const target = typosquatTarget(c.name, eco);
    if (target) out.push({ kind: "typosquat", severity: "high", ref: `typosquat:${target}`, component: id, title: `${c.name} is one edit away from the popular package ${target}` });
    if (isInternalName(c.name, s) && c.resolvedHost && !s.internalHosts.includes(c.resolvedHost)) out.push({ kind: "dependency_confusion", severity: "critical", ref: "dependency-confusion", component: id, title: `${c.name} has an internal name but was resolved from ${c.resolvedHost}` });
    if (c.hasInstallScript) out.push({ kind: "install_script", severity: "medium", ref: "install-script", component: id, title: `${c.name} runs a script when it is installed` });
    if (c.resolvedHost && c.hasIntegrity === false) out.push({ kind: "provenance", severity: "low", ref: "no-integrity", component: id, title: `${c.name} has no integrity hash in the lockfile` });
    if (!c.licenses.length) out.push({ kind: "license", severity: "low", ref: "license:none", component: id, title: `${c.name} declares no license` });
    for (const l of c.licenses) {
      const cls = classifyLicense(l, s.licenses);
      if (cls === "prohibited") out.push({ kind: "license", severity: "high", ref: `license:${l}`, component: id, title: `${c.name} is licensed ${l}, which your license policy prohibits` });
      else if (cls === "review") out.push({ kind: "license", severity: "medium", ref: `license:${l}`, component: id, title: `${c.name} is licensed ${l}, which your license policy sends for review` });
      else if (cls === "unknown") out.push({ kind: "license", severity: "low", ref: `license:${l}`, component: id, title: `${c.name} is licensed ${l}, which your license policy does not list` });
    }
  }
  return out;
}

// ---------- OSV.dev ----------

export type JsonSender = (req: { method: "GET" | "POST"; url: string; body?: unknown }) => Promise<{ status: number; json: unknown }>;

const defaultJsonSender: JsonSender = (req) =>
  new Promise((resolve, reject) => {
    const url = new URL(req.url);
    const client = url.protocol === "https:" ? httpsRequest : httpRequest;
    const body = req.body === undefined ? undefined : JSON.stringify(req.body);
    const r = client(url, { method: req.method, headers: { "content-type": "application/json", "user-agent": "AEGIS-Software-Security/1" }, lookup: pinnedLookup(env().AEGIS_ALLOW_PRIVATE_DESTINATIONS), timeout: 20_000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        if (text.length < 8 * 1024 * 1024) text += c;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) });
        } catch {
          resolve({ status: res.statusCode ?? 0, json: null });
        }
      });
    });
    r.on("timeout", () => r.destroy(new Error("OSV.dev did not answer in time")));
    r.on("error", reject);
    r.end(body);
  });

let jsonSender: JsonSender = defaultJsonSender;
export function setSoftwareJsonSender(s: JsonSender | null) {
  jsonSender = s ?? defaultJsonSender;
}
export function osvBaseUrl() {
  return process.env.AEGIS_OSV_URL ?? "https://api.osv.dev";
}

const OSV_ECOSYSTEM: Record<string, string> = { npm: "npm", pypi: "PyPI", maven: "Maven", go: "Go", nuget: "NuGet", cargo: "crates.io" };

/** Queries OSV.dev for public components. Internal names are never sent. At most 500 components and 100 advisories per call. */
export async function osvLookup(components: ParsedComponent[], s: SoftwarePolicySettings): Promise<ParsedFinding[]> {
  const pub = components.filter((c) => c.version && OSV_ECOSYSTEM[c.ecosystem] && !isInternalName(c.name, s)).slice(0, 500);
  if (!pub.length) return [];
  const res = await jsonSender({ method: "POST", url: `${osvBaseUrl()}/v1/querybatch`, body: { queries: pub.map((c) => ({ package: { name: c.name, ecosystem: OSV_ECOSYSTEM[c.ecosystem] }, version: c.version })) } });
  if (res.status !== 200) throw new Error(`OSV.dev answered ${res.status}`);
  const hits: { id: string; component: string }[] = [];
  arr(get(res.json, "results")).forEach((r, i) => {
    for (const v of arr(get(r, "vulns"))) hits.push({ id: str(get(v, "id")), component: `${pub[i]!.name}@${pub[i]!.version}` });
  });
  const ids = [...new Set(hits.map((h) => h.id))].slice(0, 100);
  const details = new Map<string, { severity: ParsedFinding["severity"]; summary: string; text: string; fixed: string | null }>();
  for (const id of ids) {
    const d = await jsonSender({ method: "GET", url: `${osvBaseUrl()}/v1/vulns/${encodeURIComponent(id)}` });
    const sev = str(get(get(d.json, "database_specific"), "severity"));
    const fixed = arr(get(d.json, "affected")).flatMap((a) => arr(get(a, "ranges")).flatMap((r) => arr(get(r, "events")).map((e) => str(get(e, "fixed"))))).find(Boolean) ?? null;
    details.set(id, { severity: sev ? normalizeSeverity(sev) : "medium", summary: str(get(d.json, "summary")) || id, text: str(get(d.json, "details")), fixed });
  }
  // Malicious-package records (MAL- ids from the OpenSSF malicious packages feed) usually carry no severity, and
  // advisories for hijacked releases describe malware rather than a flaw: both are known malicious code.
  // The details are checked with stricter phrases, because ordinary vulnerability write-ups say "a malicious user could".
  const malicious = (id: string, summary: string, text: string) =>
    id.startsWith("MAL-") || /\b(malicious (code|package|version)|embedded malware|malware|backdoor)\b/i.test(summary) || /\b(considered malicious|malicious (code|package|version|dependency)|embedded malware|contains malware|backdoor(ed)?)\b/i.test(text);
  return hits
    .filter((h) => details.has(h.id))
    .map((h) => {
      const d = details.get(h.id)!;
      const bad = malicious(h.id, d.summary, d.text);
      return { kind: bad ? ("malicious" as const) : ("vulnerability" as const), severity: bad ? ("critical" as const) : d.severity, ref: h.id, component: h.component, title: d.summary.slice(0, 300), source: "osv", fixedIn: d.fixed };
    });
}

// ---------- assessment ----------

export interface RiskFactor {
  factor: string;
  points: number;
  detail: string;
}

export interface Assessment {
  score: number;
  factors: RiskFactor[];
  floor: SoftwareStatus;
  recommended: SoftwareStatus;
  basis: "policy" | "built_in";
  reasons: string[];
  policyVersionIds: string[];
}

type FindingLike = Pick<SoftwareFinding, "kind" | "severity" | "status" | "ref">;

/** Pure: points for every open finding, the built-in floor, then the organization's policy can only make it stricter. */
export function assessSoftware(input: { item: Pick<SoftwareItem, "name" | "ecosystem" | "version">; components: number; findings: FindingLike[]; scorecard: number | null }, policies: PolicyToEvaluate[] = [], integrityFailures: { policyKey: string }[] = []): Assessment {
  const open = input.findings.filter((f) => f.status === "open");
  const count = (kind: string, sev?: string) => open.filter((f) => f.kind === kind && (!sev || f.severity === sev)).length;
  const factors: RiskFactor[] = [];
  const add = (factor: string, points: number, detail: string) => points > 0 && factors.push({ factor, points, detail });
  const vc = count("vulnerability", "critical"), vh = count("vulnerability", "high"), vm = count("vulnerability", "medium"), vl = count("vulnerability", "low");
  add("Critical vulnerabilities", Math.min(80, vc * 40), `${vc} known critical vulnerabilities without an accepted risk`);
  add("High vulnerabilities", Math.min(60, vh * 20), `${vh} known high vulnerabilities`);
  add("Medium and low vulnerabilities", Math.min(20, vm * 5 + vl), `${vm} medium and ${vl} low`);
  add("Known malicious code", count("malicious") ? 100 : 0, `${count("malicious")} components with a published malicious-code record`);
  add("Possible typosquatting", count("typosquat") ? 50 : 0, `${count("typosquat")} components named one edit away from a popular package`);
  add("Dependency confusion", count("dependency_confusion") ? 60 : 0, `${count("dependency_confusion")} internal names resolved from a public registry`);
  add("Secrets in the code", count("secret") ? 30 : 0, `${count("secret")} secrets found by a scanner`);
  add("Install scripts", Math.min(20, count("install_script") * 5), `${count("install_script")} components run code when installed`);
  const prohibited = open.filter((f) => f.kind === "license" && f.severity === "high").length;
  const review = open.filter((f) => f.kind === "license" && f.severity === "medium").length;
  add("Prohibited licenses", prohibited ? 50 : 0, `${prohibited} components under licenses your policy prohibits`);
  add("Licenses to review", Math.min(20, review * 10), `${review} components under licenses your policy sends for review`);
  add("Missing integrity hashes", Math.min(10, count("provenance") * 2), `${count("provenance")} components without an integrity hash`);
  add("Weak maintenance signals", Math.min(20, count("maintenance") * 5), `${count("maintenance")} OpenSSF Scorecard checks at 3 or below`);
  if (input.scorecard !== null && input.scorecard < 4) add("Low OpenSSF Scorecard", 15, `Overall score ${input.scorecard}/10`);
  if (input.components === 0) add("No component inventory", 15, "No SBOM or lockfile was provided, so dependencies are unknown");
  const score = Math.min(100, factors.reduce((n, f) => n + f.points, 0));

  let floor: SoftwareStatus = "approved";
  const reasons: string[] = [];
  const raise = (s: SoftwareStatus, why: string) => {
    if (STATUS_RANK[s] > STATUS_RANK[floor]) floor = s;
    reasons.push(why);
  };
  if (count("malicious")) raise("prohibited", "A component has a published record of malicious code");
  if (count("typosquat") || count("dependency_confusion")) raise("prohibited", "A component looks like typosquatting or dependency confusion");
  if (prohibited) raise("prohibited", "A component's license is prohibited by your license policy");
  if (count("secret") || vc) raise("quarantined", vc ? "Known critical vulnerabilities" : "Secrets were found in the code");
  if (vh || count("install_script")) raise("restricted", vh ? "Known high vulnerabilities" : "Components run code at install time");
  if (review || input.components === 0 || open.some((f) => f.kind === "license" && f.severity === "low" && f.ref !== "license:none")) raise("under_review", input.components === 0 ? "No component inventory" : "Licenses need review");
  if (!reasons.length) reasons.push("No known problem found by these checks. This does not prove the software is safe.");

  if (integrityFailures.length) return { score, factors, floor, recommended: "prohibited", basis: "policy", reasons: [`Software policy ${integrityFailures.map((f) => f.policyKey).join(", ")} failed its integrity check`], policyVersionIds: policies.map((p) => p.policyVersionId) };
  if (!policies.length) return { score, factors, floor, recommended: floor, basis: "built_in", reasons, policyVersionIds: [] };
  const evalInput = {
    action: { tool: "software.use", name: "software.use" },
    software: { name: input.item.name, ecosystem: input.item.ecosystem, version: input.item.version },
    risk: { score },
    sbom: { components: input.components },
    scorecard: { score: input.scorecard },
    findings: { critical: vc, high: vh, medium: vm, low: vl, malicious: count("malicious"), typosquat: count("typosquat"), dependencyConfusion: count("dependency_confusion"), secrets: count("secret"), installScripts: count("install_script"), prohibitedLicenses: prohibited, reviewLicenses: review, missingIntegrity: count("provenance") },
  };
  const r = evaluatePolicies(policies, evalInput);
  const fromPolicy: SoftwareStatus = r.result === "allow" ? "approved" : r.result === "restrict" ? "restricted" : r.result === "quarantine" ? "quarantined" : r.result === "deny" ? "prohibited" : "under_review";
  const recommended = STATUS_RANK[fromPolicy] >= STATUS_RANK[floor] ? fromPolicy : floor;
  return { score, factors, floor, recommended, basis: "policy", reasons: STATUS_RANK[fromPolicy] >= STATUS_RANK[floor] ? [...r.reasons, ...reasons.filter((x) => !x.startsWith("No known problem"))] : reasons, policyVersionIds: policies.map((p) => p.policyVersionId) };
}

async function softwarePolicies(db: TenantDb, orgId: string): Promise<PolicyToEvaluate[]> {
  const assignments = await db.policyAssignment.findMany({ where: { orgId, targetType: "org", policy: { category: SOFTWARE_CATEGORY, archived: false } }, include: { policy: true } });
  const ids = [...new Set(assignments.map((a) => a.policy.currentVersionId).filter((v): v is string => !!v))];
  if (!ids.length) return [];
  const versions = await db.policyVersion.findMany({ where: { id: { in: ids }, state: "active" } });
  return versions.map((v) => ({ policyKey: assignments.find((a) => a.policy.currentVersionId === v.id)!.policy.key, policyVersionId: v.id, policyVersion: v.version, document: v.document as unknown as PolicyDocument, contentHash: v.contentHash })).sort((a, b) => a.policyKey.localeCompare(b.policyKey));
}

// ---------- workflow ----------

async function entitled(db: TenantDb, orgId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { plan: true } });
  if (!planIncludes(normalizePlan(org.plan), "software_security")) throw forbidden("Software security is not part of this organization's plan");
}

export const softwareRequestSchema = z.object({ name: z.string().trim().min(1).max(200), ecosystem: z.enum(ECOSYSTEMS), version: z.string().trim().min(1).max(80), purpose: z.string().trim().max(1000).default("") }).strict();

/** Anyone in the organization can ask to use software. The request starts under review. */
export async function requestSoftware(db: TenantDb, ctx: OrgContext, raw: z.input<typeof softwareRequestSchema>) {
  assertPermission(ctx, "org:read");
  await entitled(db, ctx.orgId);
  const input = softwareRequestSchema.parse(raw);
  const dup = await db.softwareItem.findUnique({ where: { orgId_ecosystem_name_version: { orgId: ctx.orgId, ecosystem: input.ecosystem, name: input.name, version: input.version } } });
  if (dup) throw validation(`${input.name} ${input.version} has already been requested`);
  const row = await db.softwareItem.create({ data: { orgId: ctx.orgId, ...input, requestedBy: ctx.actor.type === "user" ? ctx.actor.id : null } });
  await appendEvidence(db, ctx, { type: "software.requested", subjectType: "software_item", subjectId: row.id, payload: { name: row.name, ecosystem: row.ecosystem, version: row.version } });
  return reassess(db, ctx, row.id, "requested");
}

export const SOFTWARE_EVIDENCE_FORMATS = ["cyclonedx", "spdx", "npm_lock", "grype", "trivy", "gitleaks", "scorecard"] as const;
export type SoftwareEvidenceFormat = (typeof SOFTWARE_EVIDENCE_FORMATS)[number];

/** Attaches an SBOM or a scanner report. The file is reduced to components and findings and then discarded. */
export async function attachSoftwareEvidence(db: TenantDb, ctx: OrgContext, itemId: string, input: { format: SoftwareEvidenceFormat; text: string }) {
  assertPermission(ctx, "security:write");
  await entitled(db, ctx.orgId);
  if (!SOFTWARE_EVIDENCE_FORMATS.includes(input.format)) throw validation("Unknown format");
  if (input.text.length > 25 * 1024 * 1024) throw validation("The file is larger than 25 MB");
  const item = await db.softwareItem.findUnique({ where: { id: itemId } });
  if (!item) throw notFound("Software");
  const settings = readSoftwareSettings(await orgSettings(db, ctx.orgId));
  let summary: Record<string, unknown> = {};
  if (input.format === "cyclonedx" || input.format === "spdx" || input.format === "npm_lock") {
    const comps = input.format === "cyclonedx" ? parseCycloneDx(input.text) : input.format === "spdx" ? parseSpdx(input.text) : parseNpmLock(input.text);
    if (comps.length > 20_000) throw validation("More than 20,000 components");
    await db.softwareComponent.createMany({ data: comps.map((c) => ({ orgId: ctx.orgId, itemId, name: c.name.slice(0, 300), version: c.version.slice(0, 100), ecosystem: c.ecosystem || item.ecosystem, purl: c.purl, licenses: c.licenses.slice(0, 10), resolvedHost: c.resolvedHost, hasIntegrity: c.hasIntegrity, hasInstallScript: c.hasInstallScript, direct: c.direct })), skipDuplicates: true });
    const local = localChecks(comps, settings, item.ecosystem);
    await upsertFindings(db, ctx.orgId, itemId, local.map((f) => ({ ...f, source: "aegis", fixedIn: null })));
    let osv: ParsedFinding[] = [];
    let osvError: string | null = null;
    if (settings.osvLookup) {
      try {
        osv = await osvLookup(comps, settings);
        await upsertFindings(db, ctx.orgId, itemId, osv);
      } catch (e) {
        osvError = e instanceof Error ? e.message : "OSV.dev lookup failed";
      }
    }
    summary = { components: comps.length, localFindings: local.length, osvFindings: osv.length, osvLookup: settings.osvLookup, osvError };
  } else if (input.format === "scorecard") {
    const sc = parseScorecard(input.text);
    await upsertFindings(db, ctx.orgId, itemId, sc.findings);
    summary = { score: sc.score, findings: sc.findings.length };
  } else {
    const fs = input.format === "grype" ? parseGrype(input.text) : input.format === "trivy" ? parseTrivy(input.text) : parseGitleaks(input.text);
    await upsertFindings(db, ctx.orgId, itemId, fs);
    summary = { findings: fs.length, bySeverity: fs.reduce<Record<string, number>>((m, f) => ({ ...m, [f.severity]: (m[f.severity] ?? 0) + 1 }), {}) };
  }
  await db.softwareEvidence.create({ data: { orgId: ctx.orgId, itemId, format: input.format, tool: input.format, summary: summary as Prisma.InputJsonValue, createdBy: ctx.actor.type === "user" ? ctx.actor.id : null } });
  await appendEvidence(db, ctx, { type: "software.evidence_attached", subjectType: "software_item", subjectId: itemId, payload: { format: input.format, ...summary } });
  return reassess(db, ctx, itemId, `${input.format} attached`);
}

async function upsertFindings(db: TenantDb, orgId: string, itemId: string, fs: { kind: string; severity: string; ref: string; component: string; title: string; source: string; fixedIn: string | null }[]) {
  if (!fs.length) return;
  await db.softwareFinding.createMany({ data: fs.map((f) => ({ orgId, itemId, kind: f.kind, severity: f.severity, ref: f.ref.slice(0, 200), component: f.component.slice(0, 300), title: f.title.slice(0, 300), source: f.source, fixedIn: f.fixedIn })), skipDuplicates: true });
}

/** Recomputes the assessment. If the recommendation is now stricter than an existing approval, flags it and raises a security event. */
export async function reassess(db: TenantDb, ctx: OrgContext, itemId: string, trigger: string) {
  const item = await db.softwareItem.findUniqueOrThrow({ where: { id: itemId } });
  const [components, findings, scorecardEv, policies] = await Promise.all([
    db.softwareComponent.count({ where: { itemId } }),
    db.softwareFinding.findMany({ where: { itemId }, select: { kind: true, severity: true, status: true, ref: true } }),
    db.softwareEvidence.findFirst({ where: { itemId, format: "scorecard" }, orderBy: { createdAt: "desc" } }),
    softwarePolicies(db, ctx.orgId),
  ]);
  const scorecard = (scorecardEv?.summary as { score?: number } | undefined)?.score ?? null;
  const a = assessSoftware({ item, components, findings, scorecard }, policies, policyIntegrityFailures(policies));
  const settings = readSoftwareSettings(await orgSettings(db, ctx.orgId));
  const decided = item.status !== "under_review";
  const worse = decided && STATUS_RANK[a.recommended] > STATUS_RANK[item.status as SoftwareStatus];
  const auto = !decided && settings.autoApprove && a.recommended === "approved";
  const updated = await db.softwareItem.update({
    where: { id: itemId },
    data: { recommended: a.recommended, riskScore: a.score, riskFactors: a.factors as unknown as Prisma.InputJsonValue, policyVersionIds: a.policyVersionIds, lastAssessedAt: ctx.now ?? new Date(), reassessmentNeeded: worse, ...(auto ? { status: "approved", decidedBy: null, decidedAt: ctx.now ?? new Date(), decisionNote: "Approved automatically: the assessment found no known problem and automatic approval is on" } : {}) },
  });
  await appendEvidence(db, ctx, { type: "software.assessed", subjectType: "software_item", subjectId: itemId, payload: { trigger, score: a.score, recommended: a.recommended, basis: a.basis, reasons: a.reasons, policyVersionIds: a.policyVersionIds, autoApproved: auto } });
  if (worse && !item.reassessmentNeeded) {
    await createSecurityEvent(db, ctx, { type: "software.reassessment_needed", severity: STATUS_RANK[a.recommended] >= STATUS_RANK.quarantined ? "high" : "medium", title: `${item.name} ${item.version} is ${item.status} but now assesses as ${a.recommended}`, detail: { softwareItemId: itemId, status: item.status, recommended: a.recommended, trigger }, escalate: false });
  }
  return { item: updated, assessment: a };
}

export const softwareDecisionSchema = z.object({ status: z.enum(["approved", "restricted", "quarantined", "prohibited", "under_review"]), note: z.string().trim().max(2000).default("") }).strict();

/** A person decides. Not the requester; deciding below the recommendation needs a written reason. */
export async function decideSoftware(db: TenantDb, ctx: OrgContext, itemId: string, raw: z.input<typeof softwareDecisionSchema>) {
  assertPermission(ctx, "security:write");
  if (ctx.actor.type !== "user") throw forbidden("A person decides on software");
  const input = softwareDecisionSchema.parse(raw);
  const item = await db.softwareItem.findUnique({ where: { id: itemId } });
  if (!item) throw notFound("Software");
  if (item.requestedBy && item.requestedBy === ctx.actor.id) throw forbidden("The person who asked for this software cannot also decide on it");
  const below = STATUS_RANK[input.status] < STATUS_RANK[item.recommended as SoftwareStatus];
  if (below && input.note.length < 10) throw validation(`The assessment recommends ${item.recommended}; explain in at least 10 characters why you decide ${input.status}`);
  const row = await db.softwareItem.update({ where: { id: itemId }, data: { status: input.status, decidedBy: ctx.actor.id, decidedAt: ctx.now ?? new Date(), decisionNote: input.note, reassessmentNeeded: false } });
  await appendEvidence(db, ctx, { type: "software.decided", subjectType: "software_item", subjectId: itemId, payload: { name: row.name, version: row.version, status: input.status, recommended: item.recommended, belowRecommendation: below, note: input.note } });
  return row;
}

/** Accepting a finding records a person's judgment; it stops counting toward the score. */
export async function acceptSoftwareFinding(db: TenantDb, ctx: OrgContext, findingId: string, note: string) {
  assertPermission(ctx, "security:write");
  if (note.trim().length < 10) throw validation("Explain in at least 10 characters why this risk is accepted");
  const f = await db.softwareFinding.findUnique({ where: { id: findingId } });
  if (!f) throw notFound("Finding");
  await db.softwareFinding.update({ where: { id: findingId }, data: { status: "accepted", note: note.trim() } });
  await appendEvidence(db, ctx, { type: "software.finding_accepted", subjectType: "software_item", subjectId: f.itemId, payload: { findingId, kind: f.kind, ref: f.ref, note: note.trim() } });
  return reassess(db, ctx, f.itemId, "finding accepted");
}

export const softwareSettingsSchema = z
  .object({
    internalPrefixes: z.array(z.string().trim().min(2).max(80)).max(20),
    internalHosts: z.array(z.string().trim().min(3).max(200)).max(20),
    osvLookup: z.boolean(),
    autoApprove: z.boolean(),
  })
  .strict();

export async function updateSoftwareSettings(db: TenantDb, ctx: OrgContext, raw: z.input<typeof softwareSettingsSchema>) {
  assertPermission(ctx, "security:write");
  const input = softwareSettingsSchema.parse(raw);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { settings: true } });
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const software = { ...((settings.software ?? {}) as Record<string, unknown>), ...input };
  await db.organization.update({ where: { id: ctx.orgId }, data: { settings: { ...settings, software } as Prisma.InputJsonValue } });
  await appendEvidence(db, ctx, { type: "software.settings_changed", subjectType: "organization", subjectId: ctx.orgId, payload: input });
  return readSoftwareSettings({ software });
}

export async function listSoftware(db: TenantDb, ctx: OrgContext) {
  assertPermission(ctx, "org:read");
  const rows = await db.softwareItem.findMany({ where: { orgId: ctx.orgId }, orderBy: [{ reassessmentNeeded: "desc" }, { createdAt: "desc" }], include: { _count: { select: { components: true, findings: { where: { status: "open" } } } } } });
  return rows;
}

export async function getSoftware(db: TenantDb, ctx: OrgContext, id: string) {
  assertPermission(ctx, "org:read");
  const item = await db.softwareItem.findUnique({ where: { id }, include: { findings: { orderBy: [{ status: "asc" }, { createdAt: "asc" }] } } });
  if (!item) throw notFound("Software");
  const [components, evidence] = await Promise.all([db.softwareComponent.findMany({ where: { itemId: id }, orderBy: [{ direct: "desc" }, { name: "asc" }], take: 500 }), db.softwareEvidence.findMany({ where: { itemId: id }, orderBy: { createdAt: "desc" } })]);
  const sev = { critical: 0, high: 1, medium: 2, low: 3 } as Record<string, number>;
  return { item: { ...item, findings: [...item.findings].sort((a, b) => (a.status === b.status ? (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9) : a.status === "open" ? -1 : 1)) }, components: components as SoftwareComponent[], evidence };
}

/** Worker job: re-queries OSV.dev for decided software when the lookup is on, and reassesses. Idempotent: findings are unique. */
export async function refreshSoftwareAdvisories(db: TenantDb, ctx: OrgContext, opts: { limit?: number } = {}) {
  const settings = readSoftwareSettings(await orgSettings(db, ctx.orgId));
  if (!settings.osvLookup) return { checked: 0, newFindings: 0, skipped: "OSV lookup is off" };
  const items = await db.softwareItem.findMany({ where: { orgId: ctx.orgId, status: { in: ["approved", "restricted"] } }, take: opts.limit ?? 50, orderBy: { lastAssessedAt: "asc" } });
  let newFindings = 0;
  for (const it of items) {
    const comps = await db.softwareComponent.findMany({ where: { itemId: it.id } });
    const before = await db.softwareFinding.count({ where: { itemId: it.id } });
    const found = await osvLookup(comps.map((c) => ({ name: c.name, version: c.version, ecosystem: c.ecosystem, purl: c.purl, licenses: c.licenses, resolvedHost: c.resolvedHost, hasIntegrity: c.hasIntegrity, hasInstallScript: c.hasInstallScript, direct: c.direct })), settings);
    await upsertFindings(db, ctx.orgId, it.id, found);
    const added = (await db.softwareFinding.count({ where: { itemId: it.id } })) - before;
    newFindings += added;
    if (added > 0) await reassess(db, ctx, it.id, `${added} new advisories from OSV.dev`);
  }
  return { checked: items.length, newFindings };
}
