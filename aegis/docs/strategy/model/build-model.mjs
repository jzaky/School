// Nexus AI Assurance: 12-month scenario model for the proposed AED 1,000,000 raise.
// STATUS: PROPOSED - NOT APPROVED FOR IMPLEMENTATION.
// Every input below is a planning assumption unless marked "plan" (taken from the founder's
// directive). Nothing here is a vendor quotation, a market price or a financial record.
// Run: node docs/strategy/model/build-model.mjs  (writes model.json and monthly.csv next to it)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MONTHS = 12;
const OPENING_CASH = 1_000_000; // assumption: the full raise arrives before month 1; no other cash is known

// spend(month) helpers
const flat = (amount, from = 1, to = MONTHS) => (m) => (m >= from && m <= to ? amount : 0);
const at = (schedule) => (m) => schedule[m] ?? 0;

// AI and agent usage, AED per month (assumptions, see AEGIS_12_MONTH_FINANCIAL_MODEL.md section 4)
export const AI_USAGE = {
  low: { claude: 1_000, agentExecution: 500, note: "Development on subscriptions only; agents run a few research tasks a week" },
  expected: { claude: 2_000, agentExecution: 1_000, note: "Development plus three internal agents on light daily schedules" },
  high: { claude: 6_000, agentExecution: 3_000, note: "Heavy API use by agents (long research runs, repository-wide analysis) and pilot support" },
};

function costLines(s) {
  const ai = AI_USAGE[s.aiUsage];
  return {
    // Founder (plan)
    founder: flat(12_500),
    // Fractional CTO and specialist engineering (plan: 160,000)
    fractionalCto: flat(8_000),
    securityCodeReviews: at({ 2: 10_000, 3: 5_000, 7: 10_000, 10: 10_000 }),
    devopsSpecialists: at({ 3: 6_000, 6: 6_000, 8: 7_000 }),
    emergencyEngineering: at({ 9: 5_000, 11: 5_000 }),
    // Enterprise sales and partnerships
    salesAdviser: flat(s.adviserMonthly, s.adviserFrom),
    events: at(s.events),
    partnerEnablement: at(s.partner),
    procurementSupport: at(s.procurement),
    salesTravel: flat(s.travelMonthly, 5),
    // Independent security validation (plan: 140,000; conservative adds findings and a second retest)
    pentestApplication: at({ 4: 40_000 }),
    gatewayAssessment: at({ 4: 35_000 }),
    tenantApiReview: at({ 5: 20_000 }),
    cloudAssessment: at({ 6: 15_000 }),
    retest: at(s.retest),
    securityDocs: at({ 3: 10_000 }),
    // Legal and IP (plan: 100,000)
    legalNdaReview: at({ 1: 15_000 }),
    legalIpOss: at({ 1: 10_000, 2: 10_000 }),
    legalInvestment: at({ 1: 25_000 }),
    legalContracts: at(s.legalContracts),
    legalRegulatory: at({ 3: 15_000 }),
    legalContingency: at({ 9: 5_000 }),
    trademark: at(s.trademark),
    // AI agents, cloud and infrastructure (plan: 80,000 at expected usage)
    aiModelUsage: flat(ai.claude),
    agentExecution: flat(ai.agentExecution),
    hosting: flat(2_000),
    monitoringBackups: flat(667),
    crmEmail: flat(500),
    staging: flat(500),
    // Customer pilots and onboarding
    pilotEnvironments: at(s.pilotEnv),
    pilotIntegrations: at(s.pilotIntegrations),
    pilotTraining: at(s.pilotTraining),
    pilotSupport: at(s.pilotSupport),
    pilotFeedback: at(s.pilotFeedback),
    // Operations (reserve is held, never spent)
    companyAdmin: at({ 1: 18_000 }),
    accounting: flat(1_000),
    insurance: at(s.insurance),
    opsMisc: flat(833),
    // Contractors beyond the plan
    customerSuccessContractor: flat(s.csContractorMonthly, s.csContractorFrom),
  };
}

const CATEGORY = {
  founder: "Founder compensation",
  fractionalCto: "Fractional CTO and specialist engineering", securityCodeReviews: "Fractional CTO and specialist engineering", devopsSpecialists: "Fractional CTO and specialist engineering", emergencyEngineering: "Fractional CTO and specialist engineering",
  salesAdviser: "Enterprise sales and partnerships", commissions: "Enterprise sales and partnerships", events: "Enterprise sales and partnerships", partnerEnablement: "Enterprise sales and partnerships", procurementSupport: "Enterprise sales and partnerships", salesTravel: "Enterprise sales and partnerships",
  pentestApplication: "Independent security validation", gatewayAssessment: "Independent security validation", tenantApiReview: "Independent security validation", cloudAssessment: "Independent security validation", retest: "Independent security validation", securityDocs: "Independent security validation",
  legalNdaReview: "Legal and intellectual property", legalIpOss: "Legal and intellectual property", legalInvestment: "Legal and intellectual property", legalContracts: "Legal and intellectual property", legalRegulatory: "Legal and intellectual property", legalContingency: "Legal and intellectual property", trademark: "Legal and intellectual property",
  aiModelUsage: "AI agents and infrastructure", agentExecution: "AI agents and infrastructure", hosting: "AI agents and infrastructure", monitoringBackups: "AI agents and infrastructure", crmEmail: "AI agents and infrastructure", staging: "AI agents and infrastructure",
  pilotEnvironments: "Customer pilots and onboarding", pilotIntegrations: "Customer pilots and onboarding", pilotTraining: "Customer pilots and onboarding", pilotSupport: "Customer pilots and onboarding", pilotFeedback: "Customer pilots and onboarding",
  companyAdmin: "Operations (excluding reserve)", accounting: "Operations (excluding reserve)", insurance: "Operations (excluding reserve)", opsMisc: "Operations (excluding reserve)",
  customerSuccessContractor: "Customer delivery beyond the plan", customerHosting: "Customer delivery beyond the plan",
};

// Revenue events: { month signed, amount AED, kind }. Cash arrives `collectionLagMonths` later.
export const SCENARIOS = {
  conservative: {
    label: "Conservative",
    story: "Buyer interest is slower than hoped, no pilot pays within 12 months, procurement runs past month 12, security findings need a second retest, no hiring.",
    revenue: [],
    collectionLagMonths: 2,
    aiUsage: "expected",
    adviserMonthly: 0, adviserFrom: 13, // the sales gate is not passed, so no adviser is engaged
    events: { 4: 6_000, 9: 6_000 }, partner: { 6: 5_000, 10: 5_000 }, procurement: { 8: 6_000 }, travelMonthly: 1_250,
    retest: { 8: 20_000, 11: 15_000 },
    legalContracts: { 6: 10_000 }, trademark: { 2: 12_000 },
    pilotEnv: { 6: 15_000 }, pilotIntegrations: {}, pilotTraining: {}, pilotSupport: {}, pilotFeedback: {},
    insurance: { 6: 10_000 },
    csContractorMonthly: 0, csContractorFrom: 13,
    commissionRate: 0.15, customerHostingMonthly: 2_500,
    grossMarginPilot: null, grossMarginAnnual: null,
  },
  base: {
    label: "Base",
    story: "The founder's targets: three paid pilots and two annual contracts at AED 150,000, with procurement timing that is realistic for regulated buyers.",
    revenue: [
      { month: 6, amount: 30_000, kind: "pilot", customer: "A" },
      { month: 8, amount: 30_000, kind: "pilot", customer: "B" },
      { month: 9, amount: 30_000, kind: "pilot", customer: "C" },
      { month: 10, amount: 150_000, kind: "annual", customer: "A" },
      { month: 12, amount: 150_000, kind: "annual", customer: "B" },
    ],
    collectionLagMonths: 2,
    aiUsage: "expected",
    adviserMonthly: 6_000, adviserFrom: 4, // engaged at the start of quarter 2 once the sales gate is passed
    events: { 4: 8_000, 6: 8_000, 9: 9_000 }, partner: { 5: 5_000, 7: 5_000, 9: 5_000, 11: 5_000 }, procurement: { 5: 6_000, 8: 6_000, 10: 6_000 }, travelMonthly: 2_500,
    retest: { 8: 20_000 },
    legalContracts: { 4: 10_000, 6: 10_000 }, trademark: { 2: 12_000 },
    pilotEnv: { 5: 7_500, 6: 7_500 }, pilotIntegrations: { 6: 6_250, 7: 6_250, 8: 6_250, 9: 6_250 }, pilotTraining: { 6: 2_000, 7: 2_000, 8: 2_000, 9: 2_000, 10: 2_000, 11: 2_000 }, pilotSupport: { 7: 2_000, 8: 2_000, 9: 2_000, 10: 2_000, 11: 2_000 }, pilotFeedback: { 9: 2_000, 10: 2_000, 11: 2_000, 12: 2_000 },
    insurance: { 4: 10_000 },
    csContractorMonthly: 0, csContractorFrom: 13,
    commissionRate: 0.15, customerHostingMonthly: 2_500,
  },
  upside: {
    label: "Upside",
    story: "A partner brings deals early: five paid pilots and four annual contracts, more delivery work and a customer success contractor from month 9.",
    revenue: [
      { month: 5, amount: 40_000, kind: "pilot", customer: "A" },
      { month: 6, amount: 40_000, kind: "pilot", customer: "B" },
      { month: 7, amount: 40_000, kind: "pilot", customer: "C" },
      { month: 8, amount: 40_000, kind: "pilot", customer: "D" },
      { month: 9, amount: 40_000, kind: "pilot", customer: "E" },
      { month: 8, amount: 150_000, kind: "annual", customer: "A" },
      { month: 9, amount: 150_000, kind: "annual", customer: "B" },
      { month: 10, amount: 150_000, kind: "annual", customer: "C" },
      { month: 12, amount: 150_000, kind: "annual", customer: "D" },
    ],
    collectionLagMonths: 2,
    aiUsage: "high",
    adviserMonthly: 6_000, adviserFrom: 3,
    events: { 3: 8_000, 5: 8_000, 7: 8_000, 9: 8_000 }, partner: { 4: 5_000, 6: 5_000, 8: 5_000, 10: 5_000, 12: 5_000 }, procurement: { 5: 6_000, 7: 6_000, 9: 6_000, 11: 6_000 }, travelMonthly: 3_000,
    retest: { 8: 20_000 },
    legalContracts: { 4: 10_000, 6: 10_000, 9: 10_000 }, trademark: { 2: 12_000 },
    pilotEnv: { 4: 7_500, 5: 7_500, 7: 7_500 }, pilotIntegrations: { 5: 7_500, 6: 7_500, 7: 7_500, 8: 7_500, 9: 7_500 }, pilotTraining: { 5: 3_000, 6: 3_000, 7: 3_000, 8: 3_000, 9: 3_000 }, pilotSupport: { 6: 3_000, 7: 3_000, 8: 3_000, 9: 3_000, 10: 3_000 }, pilotFeedback: { 8: 2_000, 9: 2_000, 10: 2_000, 11: 2_000, 12: 2_000 },
    insurance: { 4: 10_000 },
    csContractorMonthly: 10_000, csContractorFrom: 9,
    commissionRate: 0.15, customerHostingMonthly: 2_500,
  },
};

const PLAN_QUARTERS = [210_000, 230_000, 270_000, 240_000];
const RESERVE = 50_000;

function run(key) {
  const s = SCENARIOS[key];
  const lines = costLines(s);
  const months = [];
  let cash = OPENING_CASH;
  let commissionDue = 0;
  for (let m = 1; m <= MONTHS; m++) {
    const costs = {};
    for (const [k, f] of Object.entries(lines)) costs[k] = f(m);
    const annualActive = s.revenue.filter((r) => r.kind === "annual" && r.month <= m).length;
    costs.customerHosting = annualActive * s.customerHostingMonthly;
    const collected = s.revenue.filter((r) => r.month + s.collectionLagMonths === m).reduce((a, r) => a + r.amount, 0);
    costs.commissions = commissionDue; // paid the month after collection
    commissionDue = Math.round(collected * s.commissionRate);
    const signedThisMonth = s.revenue.filter((r) => r.month === m).reduce((a, r) => a + r.amount, 0);
    const spend = Object.values(costs).reduce((a, b) => a + b, 0);
    cash = cash - spend + collected;
    const arr = s.revenue.filter((r) => r.kind === "annual" && r.month <= m).reduce((a, r) => a + r.amount, 0);
    months.push({ month: m, spend, collected, signedThisMonth, netBurn: spend - collected, cash, contractedArr: arr, costs });
  }
  const byCategory = {};
  for (const mo of months) for (const [k, v] of Object.entries(mo.costs)) byCategory[CATEGORY[k]] = (byCategory[CATEGORY[k]] ?? 0) + v;
  const totalSpend = months.reduce((a, m) => a + m.spend, 0);
  const totalCollected = months.reduce((a, m) => a + m.collected, 0);
  const totalSigned = s.revenue.reduce((a, r) => a + r.amount, 0);
  const quarters = [0, 1, 2, 3].map((q) => months.slice(q * 3, q * 3 + 3).reduce((a, m) => a + m.spend, 0));
  // Run-rate after month 12: the fixed monthly cost base at month 12, less recurring revenue (ARR / 12).
  const fixedMonthly = ["founder", "fractionalCto", "salesAdviser", "aiModelUsage", "agentExecution", "hosting", "monitoringBackups", "crmEmail", "staging", "accounting", "opsMisc", "customerSuccessContractor", "customerHosting"].reduce((a, k) => a + (months[11].costs[k] ?? 0), 0) + s.travelMonthly;
  const arr12 = months[11].contractedArr;
  const recurringMonthly = Math.round(arr12 / 12);
  const netRunRate = fixedMonthly - recurringMonthly;
  const cashExReserve = months[11].cash - RESERVE;
  const runwayAfter12 = netRunRate > 0 ? +(cashExReserve / netRunRate).toFixed(1) : null;
  const salesSpend = byCategory["Enterprise sales and partnerships"] ?? 0;
  const newPaying = new Set(s.revenue.map((r) => r.customer)).size; // a pilot that converts is one customer
  const pilotRevenue = s.revenue.filter((r) => r.kind === "pilot").reduce((a, r) => a + r.amount, 0);
  const pilotCost = byCategory["Customer pilots and onboarding"] ?? 0;
  const annualRevenue = s.revenue.filter((r) => r.kind === "annual").reduce((a, r) => a + r.amount, 0);
  return {
    key, label: s.label, story: s.story, aiUsage: s.aiUsage,
    totals: {
      spend: totalSpend, collected: totalCollected, signed: totalSigned, contractedArrMonth12: arr12,
      endingCash: months[11].cash, endingCashExcludingReserve: cashExReserve,
      averageMonthlyGrossBurn: Math.round(totalSpend / MONTHS), averageMonthlyNetBurn: Math.round((totalSpend - totalCollected) / MONTHS),
      runRateMonthlyCostAfterMonth12: fixedMonthly, recurringRevenueMonthlyAfterMonth12: recurringMonthly, netRunRateAfterMonth12: netRunRate,
      runwayMonthsAfterMonth12ExcludingReserve: runwayAfter12,
      headcount: { founderFte: 1, fractionalCtoFte: 0.25, salesAdviserFte: s.adviserMonthly ? 0.25 : 0, customerSuccessContractorFte: s.csContractorMonthly ? 0.5 : 0 },
      agentOperatingCostYear: (AI_USAGE[s.aiUsage].claude + AI_USAGE[s.aiUsage].agentExecution) * MONTHS,
      salesAndPartnershipSpend: salesSpend,
      payingCustomers: newPaying,
      customerAcquisitionCostPerPayingCustomer: newPaying ? Math.round(salesSpend / newPaying) : null,
      pilotGrossMarginPercent: pilotRevenue ? Math.round(((pilotRevenue - pilotCost) / pilotRevenue) * 100) : null,
      annualContractGrossMarginPercentAssumed: annualRevenue ? 75 : null,
    },
    byCategory, quarters, planQuarters: PLAN_QUARTERS,
    months: months.map(({ costs, ...rest }) => rest),
  };
}

const out = {
  status: "PROPOSED - NOT APPROVED FOR IMPLEMENTATION",
  generatedBy: "docs/strategy/model/build-model.mjs",
  currency: "AED",
  openingCash: OPENING_CASH, protectedReserve: RESERVE,
  facts: [
    "No revenue, customers, pilots, investors or financial history are recorded anywhere in the repository.",
    "Opening cash of AED 1,000,000 assumes the proposed raise closes in full before month 1; it is not secured.",
  ],
  aiUsage: AI_USAGE,
  scenarios: Object.keys(SCENARIOS).map(run),
};
writeFileSync(join(here, "model.json"), JSON.stringify(out, null, 2) + "\n");
const rows = ["scenario,month,spend_aed,cash_collected_aed,contract_value_signed_aed,net_burn_aed,cash_balance_aed,contracted_arr_aed"];
for (const sc of out.scenarios) for (const m of sc.months) rows.push([sc.key, m.month, m.spend, m.collected, m.signedThisMonth, m.netBurn, m.cash, m.contractedArr].join(","));
writeFileSync(join(here, "monthly.csv"), rows.join("\n") + "\n");
for (const sc of out.scenarios) console.log(sc.key, JSON.stringify(sc.totals), "quarters", sc.quarters.join("/"), JSON.stringify(sc.byCategory));
