import { withTenant } from "@aegis/db";
import { attachSoftwareEvidence, decideSoftware, requestSoftware, updateSoftwareSettings } from "../secure/software.js";
import type { SeededTenant } from "./demo-tenant.js";

/**
 * Software security demo data. Requests, synthetic lockfiles, SBOMs and scanner reports go through the real
 * parsers, checks and assessment. Package names marked (demo) are fictional; advisory ids are made up and
 * use a TEST prefix so nobody mistakes them for real advisories.
 */
const lockOf = (pkgs: Record<string, { version: string; license: string; host?: string; integrity?: boolean; install?: boolean }>) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { dependencies: Object.fromEntries(Object.keys(pkgs).map((k) => [k, "*"])) },
      ...Object.fromEntries(
        Object.entries(pkgs).map(([name, p]) => [
          `node_modules/${name}`,
          { version: p.version, resolved: `https://${p.host ?? "registry.npmjs.org"}/${name}/-/${name.split("/").pop()}-${p.version}.tgz`, ...(p.integrity === false ? {} : { integrity: "sha512-demo" }), license: p.license, ...(p.install ? { hasInstallScript: true } : {}) },
        ]),
      ),
    },
  });

export async function seedDemoSoftware(t: SeededTenant): Promise<number> {
  const analyst = t.users.security_analyst!.ctx;
  const engineer = t.users.engineer!.ctx;
  const gm = t.users.governance_manager!.ctx;
  return withTenant(t.orgId, async (db) => {
    await updateSoftwareSettings(db, analyst, { internalPrefixes: ["@meridian/", "mgb-"], internalHosts: ["npm.meridian-demo.example"], osvLookup: false, autoApprove: false });

    const a = await requestSoftware(db, engineer, { name: "pdf-report-kit", ecosystem: "npm", version: "2.4.1", purpose: "Generate the monthly AI governance report as PDF" });
    await attachSoftwareEvidence(db, analyst, a.item.id, { format: "npm_lock", text: lockOf({ "pdf-report-kit": { version: "2.4.1", license: "MIT" }, "font-subset": { version: "1.0.3", license: "Apache-2.0" }, "@meridian/brand-assets": { version: "1.2.0", license: "MIT", host: "npm.meridian-demo.example" } }) });
    await attachSoftwareEvidence(db, analyst, a.item.id, { format: "scorecard", text: JSON.stringify({ score: 7.4, repo: { name: "github.com/example/pdf-report-kit" }, checks: [{ name: "Maintained", score: 10, reason: "active" }, { name: "Code-Review", score: 8, reason: "most changes reviewed" }] }) });
    await decideSoftware(db, analyst, a.item.id, { status: "approved", note: "Clean lockfile, healthy maintenance signals" });

    const b = await requestSoftware(db, t.users.governance_manager!.ctx, { name: "data-wrangler", ecosystem: "pypi", version: "0.9.0", purpose: "Clean exported decision data for the risk committee" });
    await attachSoftwareEvidence(db, analyst, b.item.id, {
      format: "cyclonedx",
      text: JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", components: [{ name: "pandas", version: "2.2.2", purl: "pkg:pypi/pandas@2.2.2", licenses: [{ license: { id: "BSD-3-Clause" } }] }, { name: "reqeusts", version: "2.31.0", purl: "pkg:pypi/reqeusts@2.31.0", licenses: [{ license: { id: "Apache-2.0" } }] }] }),
    });
    await decideSoftware(db, analyst, b.item.id, { status: "prohibited", note: "Depends on reqeusts, a likely typosquat of requests" });

    const c = await requestSoftware(db, engineer, { name: "mgb-ledger-client", ecosystem: "npm", version: "3.0.0", purpose: "Internal ledger client for the reconciliation agent" });
    await attachSoftwareEvidence(db, analyst, c.item.id, { format: "npm_lock", text: lockOf({ "mgb-ledger-client": { version: "3.0.0", license: "UNLICENSED", host: "registry.npmjs.org" }, "big-number": { version: "1.1.0", license: "MIT" } }) });

    const d = await requestSoftware(db, engineer, { name: "chart-studio", ecosystem: "npm", version: "5.2.0", purpose: "Charts for the Control Center prototype" });
    await attachSoftwareEvidence(db, analyst, d.item.id, { format: "npm_lock", text: lockOf({ "chart-studio": { version: "5.2.0", license: "MIT" }, "svg-path-kit": { version: "0.4.0", license: "ISC" } }) });
    await decideSoftware(db, analyst, d.item.id, { status: "approved", note: "No findings at request time" });
    await attachSoftwareEvidence(db, analyst, d.item.id, { format: "grype", text: JSON.stringify({ matches: [{ vulnerability: { id: "TEST-2026-0042", severity: "Critical", fix: { versions: ["0.4.1"] }, description: "Path parsing allows code execution (demo advisory)" }, artifact: { name: "svg-path-kit", version: "0.4.0" } }] }) });

    const e = await requestSoftware(db, gm, { name: "local-llm-runner", ecosystem: "application", version: "0.6.2", purpose: "Run small models on analyst laptops for offline summaries" });
    await attachSoftwareEvidence(db, analyst, e.item.id, {
      format: "trivy",
      text: JSON.stringify({ Results: [{ Target: "local-llm-runner", Vulnerabilities: [{ VulnerabilityID: "TEST-2026-0107", PkgName: "http-server-lib", InstalledVersion: "1.8.0", FixedVersion: "1.8.3", Severity: "HIGH", Title: "Request smuggling (demo advisory)" }] }] }),
    });
    await attachSoftwareEvidence(db, analyst, e.item.id, { format: "npm_lock", text: lockOf({ "local-llm-runner": { version: "0.6.2", license: "MIT", install: true }, "native-gpu-bindings": { version: "2.0.0", license: "MIT", install: true, integrity: false } }) });
    return 5;
  });
}
