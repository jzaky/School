/**
 * Open-source software security (docs/SOFTWARE_SECURITY.md) with synthetic SBOMs and scanner reports in the
 * formats the tools produce. OSV.dev is replaced by a recording stand-in.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disconnectAll, ownerPrisma, withTenant, type TenantDb } from "@aegis/db";
import { makeTestTenant, addUserWithRole, type TestTenant } from "./helpers.js";
import { activateVersion, assignPolicy, createPolicy, submitForReview } from "../src/policy/service.js";
import { acceptSoftwareFinding, assessSoftware, attachSoftwareEvidence, classifyLicense, decideSoftware, DEFAULT_SOFTWARE_SETTINGS, getSoftware, parseCycloneDx, parseGitleaks, parseSpdx, refreshSoftwareAdvisories, requestSoftware, setSoftwareJsonSender, typosquatTarget, updateSoftwareSettings } from "../src/secure/software.js";

let t: TestTenant;
let engineer: Awaited<ReturnType<typeof addUserWithRole>>;
const run = <T>(fn: (db: TenantDb) => Promise<T>) => withTenant(t.orgId, fn);
const osvCalls: { method: string; url: string; body?: unknown }[] = [];

const lock = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "reporting-tool",
    lockfileVersion: 3,
    packages: {
      "": { name: "reporting-tool", dependencies: { express: "^4", lodahs: "^1", "@meridian/payments-utils": "^2", "fast-render": "^1", "gpl-widget": "^1" } },
      "node_modules/express": { version: "4.19.2", resolved: "https://registry.npmjs.org/express/-/express-4.19.2.tgz", integrity: "sha512-x", license: "MIT" },
      "node_modules/lodahs": { version: "1.0.0", resolved: "https://registry.npmjs.org/lodahs/-/lodahs-1.0.0.tgz", integrity: "sha512-y", license: "MIT" },
      "node_modules/@meridian/payments-utils": { version: "2.0.0", resolved: "https://registry.npmjs.org/@meridian/payments-utils/-/payments-utils-2.0.0.tgz", integrity: "sha512-z", license: "MIT" },
      "node_modules/fast-render": { version: "1.2.0", resolved: "https://registry.npmjs.org/fast-render/-/fast-render-1.2.0.tgz", license: "ISC", hasInstallScript: true },
      "node_modules/gpl-widget": { version: "1.0.0", resolved: "https://registry.npmjs.org/gpl-widget/-/gpl-widget-1.0.0.tgz", integrity: "sha512-w", license: "GPL-3.0-only" },
      "node_modules/express/node_modules/lodash": { version: "4.17.20", resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz", integrity: "sha512-v", license: "MIT" },
      ...extra,
    },
  });

beforeAll(async () => {
  t = await makeTestTenant("sw");
  engineer = await addUserWithRole(t, "engineer", "sweng");
  setSoftwareJsonSender(async (req) => {
    osvCalls.push(req);
    if (req.url.endsWith("/v1/querybatch")) {
      const qs = (req.body as { queries: { package: { name: string }; version: string }[] }).queries;
      return { status: 200, json: { results: qs.map((q) => (q.package.name === "lodash" && q.version === "4.17.20" ? { vulns: [{ id: "GHSA-test-0001" }] } : q.package.name === "postmark-mcp" && q.version === "1.0.16" ? { vulns: [{ id: "MAL-2025-47604" }] } : {})) } };
    }
    // The shape of the real OpenSSF malicious-package record: no severity at all.
    if (req.url.endsWith("/MAL-2025-47604")) return { status: 200, json: { id: "MAL-2025-47604", summary: "Malicious code in postmark-mcp (npm)", affected: [{ ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.16" }] }] }] } };
    return { status: 200, json: { id: "GHSA-test-0001", summary: "Prototype pollution in lodash (test advisory)", database_specific: { severity: "HIGH" }, affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }] } };
  });
}, 60_000);
afterAll(async () => {
  setSoftwareJsonSender(null);
  await t.cleanup();
  await disconnectAll();
});

describe("parsers and local checks", () => {
  it("reads CycloneDX and SPDX components with purls and licenses", () => {
    const cdx = parseCycloneDx(JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", components: [{ name: "requests", version: "2.31.0", purl: "pkg:pypi/requests@2.31.0", licenses: [{ license: { id: "Apache-2.0" } }] }, { group: "org.example", name: "lib", version: "1", licenses: [{ expression: "MIT OR GPL-2.0" }] }] }));
    expect(cdx[0]).toMatchObject({ name: "requests", ecosystem: "pypi", licenses: ["Apache-2.0"] });
    expect(cdx[1]!.name).toBe("org.example/lib");
    const spdx = parseSpdx(JSON.stringify({ spdxVersion: "SPDX-2.3", packages: [{ name: "zlib", versionInfo: "1.3", licenseConcluded: "Zlib", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:generic/zlib@1.3" }] }] }));
    expect(spdx[0]).toMatchObject({ name: "zlib", version: "1.3", licenses: ["Zlib"] });
    expect(() => parseCycloneDx("{}")).toThrow(/CycloneDX/);
  });
  it("license expressions: OR takes the most permissive choice, AND the strictest", () => {
    const p = DEFAULT_SOFTWARE_SETTINGS.licenses;
    expect(classifyLicense("MIT OR GPL-2.0", p)).toBe("allowed");
    expect(classifyLicense("MIT AND GPL-3.0-only", p)).toBe("prohibited");
    expect(classifyLicense("MPL-2.0", p)).toBe("review");
    expect(classifyLicense("Weird-License", p)).toBe("unknown");
  });
  it("typosquatting catches one-edit and separator tricks but not the real package", () => {
    expect(typosquatTarget("lodahs", "npm")).toBe("lodash");
    expect(typosquatTarget("reqeusts", "pypi")).toBe("requests");
    expect(typosquatTarget("cross_env", "npm")).toBe("cross-env");
    expect(typosquatTarget("lodash", "npm")).toBeNull();
    expect(typosquatTarget("totally-unrelated", "npm")).toBeNull();
  });
  it("a Gitleaks report never keeps the secret or the matched text", () => {
    const fs = parseGitleaks(JSON.stringify([{ RuleID: "aws-access-token", Description: "AWS access key", File: "config/dev.env", StartLine: 3, Secret: "AKIAEXAMPLESECRET0001", Match: "AWS_KEY=AKIAEXAMPLESECRET0001" }]));
    expect(JSON.stringify(fs)).not.toContain("AKIAEXAMPLESECRET0001");
    expect(fs[0]).toMatchObject({ kind: "secret", ref: "aws-access-token", component: "config/dev.env:3" });
  });
  it("a clean assessment says it does not prove safety, and missing inventory is itself a risk", () => {
    const clean = assessSoftware({ item: { name: "x", ecosystem: "npm", version: "1" }, components: 3, findings: [], scorecard: 8 });
    expect(clean).toMatchObject({ score: 0, recommended: "approved", basis: "built_in" });
    expect(clean.reasons[0]).toMatch(/does not prove the software is safe/);
    const blind = assessSoftware({ item: { name: "x", ecosystem: "npm", version: "1" }, components: 0, findings: [], scorecard: null });
    expect(blind.recommended).toBe("under_review");
    expect(blind.factors.map((f) => f.factor)).toContain("No component inventory");
  });
});

describe("the approval workflow", () => {
  let itemId = "";
  it("an engineer requests software; with no SBOM it waits for review", async () => {
    const r = await run((db) => requestSoftware(db, engineer.ctx, { name: "reporting-tool", ecosystem: "npm", version: "3.1.0", purpose: "Monthly risk reports" }));
    itemId = r.item.id;
    expect(r.item).toMatchObject({ status: "under_review", recommended: "under_review" });
  });

  it("an npm lockfile finds typosquatting, dependency confusion, an install script, a prohibited license and a missing hash; OSV adds a known vulnerability; internal names are never sent to OSV", async () => {
    await run((db) => updateSoftwareSettings(db, t.ownerCtx, { internalPrefixes: ["@meridian/"], internalHosts: ["npm.meridian.internal"], osvLookup: true, autoApprove: false }));
    const r = await run((db) => attachSoftwareEvidence(db, t.ownerCtx, itemId, { format: "npm_lock", text: lock() }));
    const { item, components } = await run((db) => getSoftware(db, t.ownerCtx, itemId));
    expect(components).toHaveLength(6);
    expect(components.find((c) => c.name === "express")!.direct).toBe(true);
    expect(components.find((c) => c.name === "lodash")!.direct).toBe(false);
    const kinds = item.findings.map((f) => `${f.kind}:${f.ref}`);
    expect(kinds).toEqual(expect.arrayContaining(["typosquat:typosquat:lodash", "dependency_confusion:dependency-confusion", "install_script:install-script", "license:license:GPL-3.0-only", "provenance:no-integrity", "vulnerability:GHSA-test-0001"]));
    expect(item.findings.find((f) => f.ref === "GHSA-test-0001")).toMatchObject({ severity: "high", source: "osv", fixedIn: "4.17.21", component: "lodash@4.17.20" });
    expect(JSON.stringify(osvCalls)).not.toContain("@meridian/");
    expect(r.assessment.recommended).toBe("prohibited");
    expect(r.assessment.factors.map((f) => f.factor)).toEqual(expect.arrayContaining(["Possible typosquatting", "Dependency confusion", "Prohibited licenses", "High vulnerabilities"]));
    expect(r.assessment.score).toBe(100);
  });

  it("the requester cannot decide, and deciding below the recommendation needs a reason", async () => {
    await expect(run((db) => decideSoftware(db, engineer.ctx, itemId, { status: "approved" }))).rejects.toThrow(/cannot also decide|security:write/);
    await expect(run((db) => decideSoftware(db, t.ownerCtx, itemId, { status: "restricted", note: "ok" }))).rejects.toThrow(/explain in at least 10 characters/);
    const row = await run((db) => decideSoftware(db, t.ownerCtx, itemId, { status: "prohibited", note: "Typosquatted dependency" }));
    expect(row).toMatchObject({ status: "prohibited", decidedBy: t.ownerUserId });
  });

  it("an approved tool that later gets a critical vulnerability is flagged for reassessment with a security event", async () => {
    const clean = await run((db) => requestSoftware(db, engineer.ctx, { name: "csv-tool", ecosystem: "npm", version: "1.0.0" }));
    const id = clean.item.id;
    const cleanLock = JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { "csv-core": "^1" } }, "node_modules/csv-core": { version: "1.0.0", resolved: "https://registry.npmjs.org/csv-core/-/csv-core-1.0.0.tgz", integrity: "sha512-a", license: "MIT" } } });
    const a = await run((db) => attachSoftwareEvidence(db, t.ownerCtx, id, { format: "npm_lock", text: cleanLock }));
    expect(a.assessment.recommended).toBe("approved");
    await run((db) => decideSoftware(db, t.ownerCtx, id, { status: "approved", note: "" }));
    const grype = JSON.stringify({ matches: [{ vulnerability: { id: "CVE-2026-99999", severity: "Critical", fix: { versions: ["1.0.1"] }, description: "Remote code execution (test)" }, artifact: { name: "csv-core", version: "1.0.0" } }] });
    const after = await run((db) => attachSoftwareEvidence(db, t.ownerCtx, id, { format: "grype", text: grype }));
    expect(after.item).toMatchObject({ status: "approved", recommended: "quarantined", reassessmentNeeded: true });
    const ev = await run((db) => db.securityEvent.findFirstOrThrow({ where: { type: "software.reassessment_needed" } }));
    expect(ev.title).toMatch(/csv-tool 1.0.0 is approved but now assesses as quarantined/);
    // Accepting the finding with a reason clears the pressure on the recommendation.
    const f = await run((db) => db.softwareFinding.findFirstOrThrow({ where: { itemId: id, ref: "CVE-2026-99999" } }));
    const accepted = await run((db) => acceptSoftwareFinding(db, t.ownerCtx, f.id, "Not reachable: we never parse untrusted CSV"));
    expect(accepted.assessment.recommended).toBe("approved");
  });

  it("an organization's software policy can only make the recommendation stricter", async () => {
    const doc = { version: 1, appliesTo: { tools: ["software.use"], actions: [], environments: [] }, rules: [{ id: "allow", effect: "allow", when: { always: true }, reason: "ok" }, { id: "no-install-scripts", effect: "quarantine", when: { attr: "findings.installScripts", op: "gt", value: 0 }, reason: "Install scripts need a sandbox review", quarantine: { severity: "medium" } }] };
    const pol = await run((db) => createPolicy(db, t.ownerCtx, { key: "software-use", name: "Software use", description: "", category: "software", document: doc, changeNote: "test" }));
    await run((db) => submitForReview(db, t.ownerCtx, pol.version.id));
    await run((db) => activateVersion(db, t.ownerCtx, pol.version.id, { fourEyes: false }));
    await run((db) => assignPolicy(db, t.ownerCtx, pol.policy.id, { targetType: "org", priority: 100 }));
    const r = await run((db) => requestSoftware(db, engineer.ctx, { name: "builder", ecosystem: "npm", version: "2.0.0" }));
    const withScript = JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { "native-thing": "^1" } }, "node_modules/native-thing": { version: "1.0.0", resolved: "https://registry.npmjs.org/native-thing/-/native-thing-1.0.0.tgz", integrity: "sha512-b", license: "MIT", hasInstallScript: true } } });
    const a = await run((db) => attachSoftwareEvidence(db, t.ownerCtx, r.item.id, { format: "npm_lock", text: withScript }));
    expect(a.assessment).toMatchObject({ basis: "policy", floor: "restricted", recommended: "quarantined" });
    // A policy that allows everything does not lift the built-in floor for a prohibited license.
    const gpl = await run((db) => requestSoftware(db, engineer.ctx, { name: "gpl-app", ecosystem: "npm", version: "1.0.0" }));
    const gplLock = JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { "gpl-only": "^1" } }, "node_modules/gpl-only": { version: "1.0.0", resolved: "https://registry.npmjs.org/gpl-only/-/gpl-only-1.0.0.tgz", integrity: "sha512-c", license: "AGPL-3.0-only" } } });
    const g = await run((db) => attachSoftwareEvidence(db, t.ownerCtx, gpl.item.id, { format: "npm_lock", text: gplLock }));
    expect(g.assessment.recommended).toBe("prohibited");
  });

  it("the advisory refresh is a no-op when nothing changed and only runs with OSV on", async () => {
    const before = osvCalls.length;
    const r = await run((db) => refreshSoftwareAdvisories(db, t.ownerCtx));
    expect(r.newFindings).toBe(0);
    expect(osvCalls.length).toBeGreaterThan(before);
    await run((db) => updateSoftwareSettings(db, t.ownerCtx, { internalPrefixes: ["@meridian/"], internalHosts: [], osvLookup: false, autoApprove: false }));
    expect(await run((db) => refreshSoftwareAdvisories(db, t.ownerCtx))).toMatchObject({ checked: 0 });
  });

  it("a published malicious-package record prohibits the software even though it carries no severity, and automatic approval cannot pass it", async () => {
    await run((db) => updateSoftwareSettings(db, t.ownerCtx, { internalPrefixes: [], internalHosts: [], osvLookup: true, autoApprove: true }));
    const r = await run((db) => requestSoftware(db, engineer.ctx, { name: "postmark-mcp", ecosystem: "npm", version: "1.0.16" }));
    const lockText = JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { "postmark-mcp": "1.0.16" } }, "node_modules/postmark-mcp": { version: "1.0.16", resolved: "https://registry.npmjs.org/postmark-mcp/-/postmark-mcp-1.0.16.tgz", integrity: "sha512-m", license: "MIT" } } });
    const a = await run((db) => attachSoftwareEvidence(db, t.ownerCtx, r.item.id, { format: "npm_lock", text: lockText }));
    expect(a.item.recommended).toBe("prohibited");
    expect(a.item.status).toBe("under_review");
    expect(a.assessment.reasons.join(" ")).toMatch(/malicious code/);
    const f = await run((db) => db.softwareFinding.findFirstOrThrow({ where: { itemId: r.item.id, ref: "MAL-2025-47604" } }));
    expect(f).toMatchObject({ kind: "malicious", severity: "critical" });
  });

  it("automatic approval, when switched on, applies only to a clean recommendation", async () => {
    await run((db) => updateSoftwareSettings(db, t.ownerCtx, { internalPrefixes: [], internalHosts: [], osvLookup: false, autoApprove: true }));
    const r = await run((db) => requestSoftware(db, engineer.ctx, { name: "tiny-lib", ecosystem: "npm", version: "0.1.0" }));
    const lockText = JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { "tiny-core": "^1" } }, "node_modules/tiny-core": { version: "1.0.0", resolved: "https://registry.npmjs.org/tiny-core/-/tiny-core-1.0.0.tgz", integrity: "sha512-d", license: "MIT" } } });
    const a = await run((db) => attachSoftwareEvidence(db, t.ownerCtx, r.item.id, { format: "npm_lock", text: lockText }));
    expect(a.item.status).toBe("approved");
    expect(a.item.decisionNote).toMatch(/automatically/);
  });

  it("an organization without the plan cannot use it", async () => {
    await ownerPrisma().organization.update({ where: { id: t.orgId }, data: { plan: "core" } });
    try {
      await expect(run((db) => requestSoftware(db, engineer.ctx, { name: "nope", ecosystem: "npm", version: "1.0.0" }))).rejects.toThrow(/not part of this organization's plan/);
    } finally {
      await ownerPrisma().organization.update({ where: { id: t.orgId }, data: { plan: "enterprise_trial" } });
    }
  });
});
