/**
 * OSV.dev validation against the real public API. No credentials needed.
 *
 *   npx tsx scripts/validate/osv.mts
 *
 * Runs AEGIS's own OSV client (packages/core/src/secure/software.ts, osvLookup) for packages with
 * well-known advisories and for an internal-looking name, and records what the real API returned.
 * In an environment without direct egress (this build environment), the bytes travel through fetch and the
 * HTTPS_PROXY instead of AEGIS's DNS-pinned sender; the record says so. Everything after the HTTP response
 * (parsing, severity, fixed version, never sending internal names) is the production code path.
 */
import { DEFAULT_SOFTWARE_SETTINGS, osvBaseUrl, osvLookup, setSoftwareJsonSender, type JsonSender, type ParsedComponent } from "../../packages/core/src/secure/software.js";
import { report, save, viaEnvProxy, type Check, type ValidationRecord } from "./record.mts";

const startedAt = new Date().toISOString();
const sent: string[] = [];
const proxied = viaEnvProxy();
if (proxied) {
  const sender: JsonSender = async (req) => {
    sent.push(req.body ? JSON.stringify(req.body) : req.url);
    const res = await fetch(req.url, { method: req.method, headers: { "content-type": "application/json" }, body: req.body ? JSON.stringify(req.body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  setSoftwareJsonSender(sender);
}

const comp = (name: string, version: string, ecosystem = "npm"): ParsedComponent => ({ name, version, ecosystem, purl: null, licenses: [], resolvedHost: null, hasIntegrity: null, hasInstallScript: null, direct: true });
const checks: Check[] = [];
const notes: string[] = [];
let mode: ValidationRecord["mode"] = "external_verified";
try {
  const settings = { ...DEFAULT_SOFTWARE_SETTINGS, internalPrefixes: ["@aegis-internal/"] };
  const found = await osvLookup([comp("lodash", "4.17.20"), comp("minimist", "1.2.5"), comp("django", "3.2.0", "pypi"), comp("@aegis-internal/secret-lib", "1.0.0")], settings);
  const lodash = found.filter((f) => f.component === "lodash@4.17.20");
  checks.push({ name: "known npm advisory found (lodash 4.17.20)", pass: lodash.length > 0, detail: `${lodash.length} advisories, e.g. ${lodash.slice(0, 3).map((f) => `${f.ref} ${f.severity} fixed ${f.fixedIn ?? "?"}`).join("; ")}` });
  const minimist = found.filter((f) => f.component === "minimist@1.2.5");
  checks.push({ name: "known npm advisory found (minimist 1.2.5)", pass: minimist.length > 0, detail: minimist.map((f) => f.ref).join(", ") || "none" });
  const django = found.filter((f) => f.component === "django@3.2.0");
  checks.push({ name: "PyPI ecosystem mapping works (django 3.2.0)", pass: django.length > 0, detail: `${django.length} advisories` });
  checks.push({ name: "every finding has a severity and a reference", pass: found.every((f) => !!f.ref && ["critical", "high", "medium", "low"].includes(f.severity)), detail: `${found.length} findings` });
  if (proxied) checks.push({ name: "internal package name never sent to OSV.dev", pass: !sent.join("\n").includes("@aegis-internal/"), detail: `${sent.length} requests inspected` });
  else notes.push("Direct transport: the internal-name check is covered by packages/core/tests/software-security.test.ts, which records every request.");
  if (found.length >= 100) notes.push("At least 100 advisories: AEGIS fetches details for at most 100 per call.");
} catch (e) {
  mode = "external_failed";
  checks.push({ name: "OSV.dev reachable", pass: false, detail: e instanceof Error ? e.message : String(e) });
}
const record: ValidationRecord = { integration: "osv", mode, hosts: [new URL(osvBaseUrl()).host], transport: proxied ? "fetch through HTTPS_PROXY (build environment without direct egress); AEGIS's DNS-pinned sender was not used" : "AEGIS DNS-pinned sender (production path)", startedAt, finishedAt: new Date().toISOString(), checks, notes };
const failed = report(record);
console.log(`record: ${save(record)}`);
process.exit(failed ? 1 : 0);
