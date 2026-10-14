import { withTenant } from "@aegis/db";
import type { OrgContext } from "../lib/context.js";
import { changeModelStage, decideModelApproval, recordEvaluation, registerModel, requestModelApproval } from "../governance/models.js";
import { completeDeletion, decideDeletion, registerDataset, requestDeletion } from "../governance/data.js";
import { addRegulatoryAction, assessRegulatoryChange, createRegulatoryChange, markRegulatoryImplemented } from "../governance/regulatory.js";
import { transition } from "../audit/remediation.js";
import type { SeededTenant } from "./demo-tenant.js";

const DAY = 86_400_000;
const at = (ctx: OrgContext, daysAgo: number): OrgContext => ({ ...ctx, now: new Date(Date.now() - daysAgo * DAY) });

/**
 * Phase 7 demo data: a model registry covering every lifecycle stage, a dataset inventory with gaps
 * left visible, deletion requests and a regulatory change register. Regulatory entries marked
 * "illustrative" are invented for the demo; the EU AI Act entry cites a real regulation.
 */
export async function seedDemoGovernance(t: SeededTenant): Promise<{ models: number; datasets: number; changes: number }> {
  const karim = t.users.engineer!.ctx;
  const omar = t.users.governance_manager!.ctx;
  const tariq = t.users.security_analyst!.ctx;
  const nadia = t.users.owner!.ctx;
  const hana = t.users.auditor!.ctx;
  return withTenant(
    t.orgId,
    async (db) => {
      // Models
      const sonnet = (await registerModel(db, at(karim, 220), { key: "claude-sonnet", name: "Claude Sonnet 5.5", provider: "anthropic", providerModelId: "claude-sonnet-5-5", riskTier: "high", intendedUse: "Customer support refunds and KYC document review, under AEGIS policies.", limitations: "Can misread scanned documents; amounts are always checked against the order system.", dataCategories: ["personal", "financial"], hostingRegion: "Provider region per contract" })).model;
      await recordEvaluation(db, at(karim, 215), sonnet.id, { kind: "accuracy", result: "pass", summary: "Refund eligibility matched the support lead's decision in 486 of 500 labelled tickets (97.2%).", metrics: { cases: 500, agreement: 0.972 } });
      await recordEvaluation(db, at(karim, 214), sonnet.id, { kind: "safety", result: "pass", summary: "150 red-team prompts asking for refunds outside policy; no request bypassed the gateway.", metrics: { cases: 150, bypasses: 0 } });
      await recordEvaluation(db, at(karim, 213), sonnet.id, { kind: "privacy", result: "conditional", summary: "Model output occasionally repeated full card numbers from tickets; Shield masks them before any tool call. Accepted with that control." });
      await requestModelApproval(db, at(karim, 212), sonnet.id, "Evaluations complete for the refund and KYC agents");
      await decideModelApproval(db, at(omar, 210), sonnet.id, { approve: true, note: "Approved for support refunds and KYC review, with Shield masking required", reviewInDays: 365 });

      const opus = (await registerModel(db, at(karim, 140), { key: "claude-opus", name: "Claude Opus 5.5", provider: "anthropic", providerModelId: "claude-opus-5-5", riskTier: "critical", intendedUse: "Treasury transfers and paper trading, always behind approval bands.", limitations: "Not evaluated for live trading.", dataCategories: ["financial"] })).model;
      await recordEvaluation(db, at(karim, 135), opus.id, { kind: "accuracy", result: "pass", summary: "Transfer instructions parsed correctly in 300 of 300 historical payment requests." });
      await recordEvaluation(db, at(karim, 134), opus.id, { kind: "security", result: "pass", summary: "Prompt-injection corpus from the Attack Simulation Lab scenarios produced no unapproved transfer." });
      await requestModelApproval(db, at(karim, 133), opus.id, "Treasury and trading pilots");
      await decideModelApproval(db, at(omar, 130), opus.id, { approve: true, note: "Approved for treasury and paper trading; re-review after the first quarter", reviewInDays: 90 });

      const haiku = (await registerModel(db, at(karim, 300), { key: "claude-haiku", name: "Claude Haiku 5.5", provider: "anthropic", providerModelId: "claude-haiku-5-5", riskTier: "medium", intendedUse: "IT helpdesk password resets.", dataCategories: ["personal", "credentials"] })).model;
      await recordEvaluation(db, at(karim, 295), haiku.id, { kind: "accuracy", result: "pass", summary: "Resolved 92% of 200 helpdesk tickets without escalation." });
      await requestModelApproval(db, at(karim, 294), haiku.id, "IT helpdesk");
      await decideModelApproval(db, at(omar, 290), haiku.id, { approve: true, note: "Approved for the IT helpdesk", reviewInDays: 365 });
      await changeModelStage(db, at(omar, 20), haiku.id, { to: "deprecated", reason: "The IT helpdesk agent was suspended after repeated denied actions; no new agents on this model" });

      const gpt = (await registerModel(db, at(karim, 12), { key: "gpt-5", name: "GPT-5", provider: "openai", providerModelId: "gpt-5", riskTier: "medium", intendedUse: "Marketing copy and outreach drafts.", dataCategories: ["personal"] })).model;
      await recordEvaluation(db, at(karim, 9), gpt.id, { kind: "privacy", result: "pass", summary: "Outreach drafts tested with 100 contact records; no personal data beyond the first name appeared in output." });
      await recordEvaluation(db, at(karim, 8), gpt.id, { kind: "safety", result: "conditional", summary: "Two of 80 drafts made claims about rates that marketing must approve; approval band added in policy." });
      await requestModelApproval(db, at(karim, 6), gpt.id, "Marketing outreach agent");

      const gemini = (await registerModel(db, at(karim, 30), { key: "gemini-pro", name: "Gemini 3 Pro", provider: "google", providerModelId: "gemini-3-pro", riskTier: "high", intendedUse: "Analytics copilot over the warehouse.", dataCategories: ["personal", "financial"] })).model;
      await recordEvaluation(db, at(karim, 25), gemini.id, { kind: "bias", result: "fail", summary: "Segment summaries described two customer nationalities with different risk language for the same behaviour. Re-test after prompt changes." });

      const old = (await registerModel(db, at(karim, 400), { key: "claude-sonnet-legacy", name: "Claude Sonnet 4.5", provider: "anthropic", providerModelId: "claude-sonnet-4-5", riskTier: "high", linkMatchingAgents: false })).model;
      await recordEvaluation(db, at(karim, 395), old.id, { kind: "accuracy", result: "pass", summary: "Baseline refund evaluation, 300 tickets." });
      await requestModelApproval(db, at(karim, 394), old.id, "First refund pilot");
      await decideModelApproval(db, at(omar, 392), old.id, { approve: true, note: "Approved for the first refund pilot", reviewInDays: 365 });
      await changeModelStage(db, at(omar, 210), old.id, { to: "retired", reason: "Replaced by Claude Sonnet 5.5 after evaluation" });

      // Datasets
      const res = Object.fromEntries((await db.resource.findMany({ select: { id: true, key: true } })).map((r) => [r.key, r.id]));
      const customers = await registerDataset(db, at(tariq, 180), { key: "customer-accounts", name: "Customer account records", description: "Core customer master data used by support and KYC agents.", ownerId: t.users.owner!.id, classification: "confidential", categories: ["personal", "financial"], resourceId: res["customer-accounts"] ?? null, storageLocation: "Core banking database", region: "UAE", retentionDays: 3650, lawfulBasis: "Contract and legal obligation (banking records)" });
      const tickets = await registerDataset(db, at(tariq, 175), { key: "support-tickets", name: "Support ticket history", description: "Customer conversations and refund requests.", ownerId: t.users.approver!.id, classification: "internal", categories: ["personal"], resourceId: res["support-tickets"] ?? null, storageLocation: "Support platform", region: "UAE", retentionDays: 730, lawfulBasis: "Contract" });
      await registerDataset(db, at(tariq, 170), { key: "payments-ledger", name: "Payments ledger", ownerId: t.users.owner!.id, classification: "restricted", categories: ["financial"], resourceId: res["payments-core"] ?? null, storageLocation: "Payments core", region: "UAE", retentionDays: 3650, lawfulBasis: "Legal obligation" });
      const marketing = await registerDataset(db, at(tariq, 60), { key: "marketing-contacts", name: "Marketing contact lists", description: "Imported from campaign tools; retention and lawful basis still to be confirmed.", classification: "internal", categories: ["personal"], resourceId: res["marketing-lists"] ?? null, storageLocation: "Campaign platform export", region: "" });
      await registerDataset(db, at(tariq, 40), { key: "analytics-extracts", name: "Analytics warehouse extracts", ownerId: t.users.governance_manager!.id, classification: "restricted", categories: ["personal", "financial"], resourceId: res["analytics-warehouse"] ?? null, storageLocation: "Cloud warehouse", region: "Outside the UAE (declared by the vendor)", retentionDays: 365, lawfulBasis: "Legitimate interest, assessment on file" });
      void customers;

      // Deletion requests: one completed, one waiting for a second person.
      const done = await requestDeletion(db, at(tariq, 20), { datasetId: marketing.id, subjectRef: "MKT-CONTACT-58213", reason: "Customer asked to be removed from marketing and to have their contact record erased" });
      await decideDeletion(db, at(nadia, 19), done.id, { approve: true, note: "Identity confirmed by the contact centre" });
      await completeDeletion(db, at(tariq, 17), done.id, { reference: "CAMPAIGN-ERASE-2291" });
      await requestDeletion(db, at(tariq, 3), { datasetId: tickets.id, subjectRef: "CUST-40917", reason: "Erasure request received by email; ticket history beyond the legal retention period" });

      // Regulatory changes
      const fw = Object.fromEntries((await db.framework.findMany({ where: { orgId: null }, select: { id: true, key: true } })).map((f) => [f.key, f.id]));
      const guidance = await createRegulatoryChange(db, at(hana, 25), { title: "Supervisory guidance on AI in customer decisions (illustrative)", source: "Illustrative supervisory guidance for the demo", jurisdiction: "UAE", frameworkId: fw["uae-pdpl"] ?? null, effectiveAt: new Date(Date.now() + 60 * DAY), summary: "Automated decisions about customers using personal data need meaningful human review above set thresholds, a record of each decision and a way for the customer to ask for review." });
      await assessRegulatoryChange(db, at(hana, 22), guidance.id, {
        status: "action_required",
        impact: { controls: [], policies: (await db.policy.findMany({ where: { key: { in: ["refund-authority", "refund-fraud-score"] } }, select: { id: true } })).map((p) => p.id), agents: [t.agents["support-refund-agent"]!, t.agents["kyc-document-agent"]!], models: [sonnet.id], datasets: [customers.id, tickets.id], notes: "Refunds below AED 500 are decided without a person; the guidance asks for human review of flagged customers." },
        note: "Applies to autonomous refunds and KYC review",
      });
      const task1 = await addRegulatoryAction(db, at(hana, 21), guidance.id, { title: "Require a person for refunds to customers with a fraud score above 0.4", ownerId: t.users.governance_manager!.id });
      await transition(db, at(hana, 10), task1.id, "in_progress", "Drafting the policy change");
      await addRegulatoryAction(db, at(hana, 21), guidance.id, { title: "Publish how customers can ask for a review of an automated refund decision", ownerId: t.users.owner!.id });

      const gpai = await createRegulatoryChange(db, at(hana, 300), { title: "EU AI Act: obligations for providers of general-purpose AI models", source: "European Union, Regulation (EU) 2024/1689", reference: "Regulation (EU) 2024/1689, Chapter V", jurisdiction: "EU", frameworkId: fw["eu-ai-act"] ?? null, effectiveAt: new Date("2025-08-02T00:00:00Z"), summary: "Obligations for providers of general-purpose AI models apply from 2 August 2025. The bank uses such models as a deployer; it needs provider documentation on file for each model it registers." });
      await assessRegulatoryChange(db, at(hana, 290), gpai.id, { status: "action_required", impact: { controls: [], policies: [], agents: [], models: [sonnet.id, opus.id], datasets: [], notes: "Provider documentation needed for each registered model." }, note: "Deployer: keep provider documentation for each model" });
      const task2 = await addRegulatoryAction(db, at(hana, 289), gpai.id, { title: "File provider documentation for each registered model", ownerId: t.users.engineer!.id });
      for (const [s, d] of [["in_progress", 280], ["review", 270], ["resolved", 265]] as const) await transition(db, at(hana, d), task2.id, s, "Documentation filed");
      await markRegulatoryImplemented(db, at(hana, 264), gpai.id, "Provider documentation filed for Claude Sonnet and Claude Opus");

      await createRegulatoryChange(db, at(nadia, 4), { title: "Group data retention standard, revision 3 (illustrative)", source: "Internal: Group Data Office", jurisdiction: "Group", effectiveAt: new Date(Date.now() + 120 * DAY), summary: "Marketing contact data must carry a retention period and a lawful basis; personal data in analytics extracts limited to 12 months." });

      return { models: 6, datasets: 5, changes: 3 };
    },
    { timeout: 120_000 },
  );
}
