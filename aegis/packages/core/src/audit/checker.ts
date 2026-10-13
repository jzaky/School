/**
 * Free public AI-agent governance checker.
 *
 * Fourteen plain questions an organization can answer about the AI agents it runs, each mapped to
 * the controls of the shared framework catalog it speaks to. Pure functions: nothing is stored and
 * no network call is made; the public website runs this in the visitor's browser. The result is a
 * self-assessment, not a compliance opinion, and the page says so.
 */

export type CheckerAnswer = "yes" | "partial" | "no" | "unsure";

export interface CheckerRef {
  /** Shared framework key, as seeded (iso-42001, eu-ai-act, ...). */
  framework: string;
  codes: string[];
}

export interface CheckerQuestion {
  id: string;
  text: string;
  help: string;
  refs: CheckerRef[];
  /** What AEGIS does for this question, stated plainly, including where it does not help. */
  aegis: string;
}

export const CHECKER_FRAMEWORKS: { key: string; name: string }[] = [
  { key: "iso-42001", name: "ISO/IEC 42001" },
  { key: "iso-27001-2022", name: "ISO/IEC 27001" },
  { key: "nist-ai-rmf-1.0", name: "NIST AI RMF" },
  { key: "eu-ai-act", name: "EU AI Act" },
  { key: "gdpr", name: "GDPR" },
  { key: "uae-pdpl", name: "UAE PDPL" },
  { key: "desc-isr", name: "Dubai DESC ISR" },
  { key: "iso-23894", name: "ISO/IEC 23894" },
  { key: "iso-42005", name: "ISO/IEC 42005" },
  { key: "iso-38507", name: "ISO/IEC 38507" },
  { key: "owasp-llm-top10", name: "OWASP LLM Top 10" },
  { key: "nist-csf-2", name: "NIST CSF 2.0" },
];

export const CHECKER_QUESTIONS: CheckerQuestion[] = [
  {
    id: "inventory",
    text: "Do you have a complete list of every AI agent that can take actions in your systems, each with a named owner?",
    help: "Agents that only answer questions count too once they can call a tool, send a message or change a record.",
    refs: [
      { framework: "eu-ai-act", codes: ["Art. 6", "Art. 49"] },
      { framework: "gdpr", codes: ["Art. 30"] },
      { framework: "uae-pdpl", codes: ["PDPL-08"] },
      { framework: "desc-isr", codes: ["ISR-03"] },
      { framework: "iso-42005", codes: ["6.2"] },
      { framework: "iso-38507", codes: ["5.2"] },
      { framework: "nist-csf-2", codes: ["ID.AM"] },
    ],
    aegis: "The agent registry holds every agent with lifecycle state, business and technical owners, risk tier, tools and versions.",
  },
  {
    id: "gate",
    text: "Does every action an agent takes against a real system pass through one control point that can refuse it?",
    help: "If an agent can reach a payment system, a CRM or an email relay without that control point, the answer is no.",
    refs: [
      { framework: "iso-42001", codes: ["A.6.2.6"] },
      { framework: "iso-27001-2022", codes: ["A.5.15"] },
      { framework: "nist-ai-rmf-1.0", codes: ["MANAGE 2.4"] },
      { framework: "eu-ai-act", codes: ["Art. 14"] },
      { framework: "desc-isr", codes: ["ISR-06"] },
      { framework: "owasp-llm-top10", codes: ["LLM06"] },
      { framework: "nist-csf-2", codes: ["PR.AA"] },
    ],
    aegis: "The Action Gateway is that control point: registry checks, data protection, deterministic policy and a single-use execution grant that the downstream system verifies. Network egress on your platform still has to close any path around it.",
  },
  {
    id: "approval",
    text: "Do high-impact actions wait for a named person to approve them before anything executes?",
    help: "High impact means money, customer data, external messages or anything hard to undo.",
    refs: [
      { framework: "iso-42001", codes: ["A.9.3"] },
      { framework: "nist-ai-rmf-1.0", codes: ["GOVERN 3.2"] },
      { framework: "eu-ai-act", codes: ["Art. 14"] },
      { framework: "gdpr", codes: ["Art. 22"] },
      { framework: "uae-pdpl", codes: ["PDPL-14"] },
      { framework: "iso-23894", codes: ["6.5.5"] },
      { framework: "iso-38507", codes: ["6.2"] },
      { framework: "owasp-llm-top10", codes: ["LLM09"] },
    ],
    aegis: "Policies route actions to the Approval Center with role, separation-of-duties and expiry rules; nothing runs while a request is pending and an expired approval can never be used.",
  },
  {
    id: "limits",
    text: "Are each agent's limits written down (what it may do, for how much, on which systems), versioned and approved by a second person?",
    help: "A prompt is not a limit. A limit is enforced outside the model.",
    refs: [
      { framework: "iso-42001", codes: ["6.1.4"] },
      { framework: "iso-27001-2022", codes: ["A.5.1"] },
      { framework: "eu-ai-act", codes: ["Art. 17"] },
      { framework: "desc-isr", codes: ["ISR-01"] },
      { framework: "iso-38507", codes: ["5.4"] },
      { framework: "nist-csf-2", codes: ["GV.PO"] },
    ],
    aegis: "Policies are versioned documents with embedded tests, a four-eyes activation rule and guided templates for refunds, score bands and trading mandates.",
  },
  {
    id: "evidence",
    text: "Is every decision about an agent's action recorded in a form that cannot be quietly edited later?",
    help: "Application logs that an administrator can rewrite do not count.",
    refs: [
      { framework: "iso-27001-2022", codes: ["A.8.15"] },
      { framework: "nist-ai-rmf-1.0", codes: ["MEASURE 2.7"] },
      { framework: "eu-ai-act", codes: ["Art. 12", "Art. 19"] },
      { framework: "desc-isr", codes: ["ISR-08"] },
      { framework: "iso-27701", codes: ["6.9.4.1"] },
      { framework: "nist-csf-2", codes: ["PR.PS"] },
    ],
    aegis: "Every decision, approval, grant and receipt is appended to a per-organization hash chain with signed checkpoints, verified on demand and exported with its public key.",
  },
  {
    id: "stop",
    text: "Can you suspend an agent and cut off its credentials within minutes, and does that stop actions already in flight?",
    help: "Count the time from deciding to stop to the moment the agent can no longer act.",
    refs: [
      { framework: "iso-42001", codes: ["A.6.2.5"] },
      { framework: "nist-ai-rmf-1.0", codes: ["MANAGE 2.3"] },
      { framework: "eu-ai-act", codes: ["Art. 20"] },
      { framework: "desc-isr", codes: ["ISR-06"] },
      { framework: "nist-csf-2", codes: ["RS.MI"] },
    ],
    aegis: "Emergency controls suspend or revoke an agent, revoke its keys, disable an integration or pause the whole gateway; pausing blocks outstanding grants as well as new requests.",
  },
  {
    id: "data",
    text: "Are the parameters an agent sends checked for personal, payment and secret data before they leave, with allowed destinations per tool?",
    help: "Think of a customer record exported to a personal cloud drive, or a card number pasted into an email.",
    refs: [
      { framework: "gdpr", codes: ["Art. 25", "Art. 32"] },
      { framework: "uae-pdpl", codes: ["PDPL-05", "PDPL-15"] },
      { framework: "eu-ai-act", codes: ["Art. 10"] },
      { framework: "iso-27018", codes: ["A.5"] },
      { framework: "desc-isr", codes: ["ISR-09"] },
      { framework: "owasp-llm-top10", codes: ["LLM02"] },
      { framework: "nist-csf-2", codes: ["PR.DS"] },
    ],
    aegis: "Shield classifies parameters (email, phone, IBAN, cards, identity numbers, keys, tokens) and masks, redacts, blocks or escalates; destination allowlists are enforced per tool.",
  },
  {
    id: "injection",
    text: "Do you detect instructions hidden in the content an agent reads (prompt injection) before it acts on them?",
    help: "Hidden text, role hijacks and tool coercion arrive through documents, web pages and emails.",
    refs: [
      { framework: "eu-ai-act", codes: ["Art. 15"] },
      { framework: "iso-23894", codes: ["6.5.4.2"] },
      { framework: "desc-isr", codes: ["ISR-08"] },
      { framework: "owasp-llm-top10", codes: ["LLM01", "LLM05"] },
    ],
    aegis: "Shield scores injection signals (override, hijack, exfiltration, coercion, encoded and hidden text) on every request and policies can refuse or escalate on them. Detection is heuristic, not complete.",
  },
  {
    id: "monitoring",
    text: "Will someone be alerted when an agent behaves abnormally, such as repeated refusals, unusual volume or a new tool?",
    help: "An alert that nobody is assigned to does not count.",
    refs: [
      { framework: "nist-ai-rmf-1.0", codes: ["MEASURE 2.6"] },
      { framework: "iso-27001-2022", codes: ["A.8.16"] },
      { framework: "eu-ai-act", codes: ["Art. 26", "Art. 72"] },
      { framework: "desc-isr", codes: ["ISR-15"] },
      { framework: "iso-42005", codes: ["6.6"] },
      { framework: "owasp-llm-top10", codes: ["LLM10"] },
      { framework: "nist-csf-2", codes: ["DE.CM"] },
    ],
    aegis: "Twelve deterministic monitoring rules raise deduplicated alerts every minute, and continuous governance can respond automatically with a reversible, recorded action.",
  },
  {
    id: "incident",
    text: "Is there an incident process for harm caused by an agent, with the reporting deadlines your regulators set?",
    help: "The EU AI Act, GDPR and the UAE law each set a clock once an incident or breach is known.",
    refs: [
      { framework: "iso-27001-2022", codes: ["A.5.24"] },
      { framework: "iso-42001", codes: ["A.8.4"] },
      { framework: "nist-ai-rmf-1.0", codes: ["MANAGE 4.1"] },
      { framework: "eu-ai-act", codes: ["Art. 73"] },
      { framework: "gdpr", codes: ["Art. 33"] },
      { framework: "uae-pdpl", codes: ["PDPL-16"] },
      { framework: "desc-isr", codes: ["ISR-12"] },
      { framework: "nist-csf-2", codes: ["RS.MA", "RS.CO"] },
    ],
    aegis: "Security events and incidents are tracked with status, containment actions and evidence. The regulatory notification itself stays with your legal team.",
  },
  {
    id: "thirdparty",
    text: "Are the systems your agents call bound by contracts, with credentials rotated and a sandbox used before anything live?",
    help: "Payment providers, brokers and helpdesks each hold a key that your agent uses.",
    refs: [
      { framework: "iso-27001-2022", codes: ["A.5.17", "A.8.24"] },
      { framework: "eu-ai-act", codes: ["Art. 25"] },
      { framework: "gdpr", codes: ["Art. 28"] },
      { framework: "uae-pdpl", codes: ["PDPL-07"] },
      { framework: "desc-isr", codes: ["ISR-11"] },
      { framework: "iso-27017", codes: ["15.1.2"] },
      { framework: "owasp-llm-top10", codes: ["LLM03"] },
      { framework: "nist-csf-2", codes: ["GV.SC"] },
    ],
    aegis: "Integrations hold encrypted credentials with rotation due dates and connection tests; the Stripe and Alpaca connectors refuse anything but test-mode and paper keys. Contracts are yours.",
  },
  {
    id: "assessment",
    text: "Is the impact and risk of an agent assessed before it goes live and again when its tools, data or limits change?",
    help: "A one-page assessment that names the harms and the mitigations is enough to say yes.",
    refs: [
      { framework: "iso-42001", codes: ["6.1.2"] },
      { framework: "eu-ai-act", codes: ["Art. 9", "Art. 27"] },
      { framework: "gdpr", codes: ["Art. 35"] },
      { framework: "uae-pdpl", codes: ["PDPL-10"] },
      { framework: "iso-23894", codes: ["6.5.4.2"] },
      { framework: "iso-42005", codes: ["5.3"] },
      { framework: "iso-38507", codes: ["6.3"] },
      { framework: "nist-csf-2", codes: ["ID.RA"] },
    ],
    aegis: "The Audit module assesses your documents against these catalogs and confirms some controls from live records. The assessment itself is your work; AEGIS does not write it.",
  },
  {
    id: "literacy",
    text: "Have the people who operate, approve for or oversee agents been trained on what the agents can do and how to stop them?",
    help: "Approvers in particular should know what they are approving.",
    refs: [
      { framework: "eu-ai-act", codes: ["Art. 4"] },
      { framework: "desc-isr", codes: ["ISR-04"] },
      { framework: "iso-38507", codes: ["6.5"] },
      { framework: "nist-csf-2", codes: ["PR.AT"] },
    ],
    aegis: "Approvals carry plain-language summaries, the rule that stopped the request and the boundary that was close, so approvers see what they decide. Training itself is not something AEGIS provides.",
  },
  {
    id: "explanation",
    text: "Can an affected person get a clear explanation of what an agent decided about them and why?",
    help: "The explanation should name the rule or limit, not just say that an algorithm decided.",
    refs: [
      { framework: "eu-ai-act", codes: ["Art. 13", "Art. 86"] },
      { framework: "gdpr", codes: ["Art. 12", "Art. 13"] },
      { framework: "uae-pdpl", codes: ["PDPL-11"] },
    ],
    aegis: "Every decision keeps the deciding rule, its reason and a boundary sentence in the policy's own units; exports let you hand that to the person. What you tell customers is your decision.",
  },
];

export const ANSWER_WEIGHT: Record<CheckerAnswer, number> = { yes: 1, partial: 0.5, no: 0, unsure: 0 };

export type CheckerLevel = "starting" | "developing" | "established";

export interface CheckerFrameworkResult {
  key: string;
  name: string;
  /** Questions in the checker that reference this framework. */
  questions: number;
  /** Weighted answers across those questions. */
  covered: number;
  percent: number;
  /** Control codes in this framework that the unanswered or negative questions point to. */
  openCodes: string[];
}

export interface CheckerResult {
  answered: number;
  total: number;
  score: number;
  level: CheckerLevel;
  frameworks: CheckerFrameworkResult[];
  /** Questions answered no, unsure or partial, weakest first. */
  gaps: CheckerQuestion[];
}

export function checkerLevel(score: number): CheckerLevel {
  if (score < 40) return "starting";
  if (score < 75) return "developing";
  return "established";
}

export function scoreChecker(answers: Partial<Record<string, CheckerAnswer>>): CheckerResult {
  const total = CHECKER_QUESTIONS.length;
  let answered = 0;
  let sum = 0;
  for (const q of CHECKER_QUESTIONS) {
    const a = answers[q.id];
    if (!a) continue;
    answered += 1;
    sum += ANSWER_WEIGHT[a];
  }
  const score = Math.round((sum / total) * 100);
  const frameworks = CHECKER_FRAMEWORKS.map((f) => {
    const qs = CHECKER_QUESTIONS.filter((q) => q.refs.some((r) => r.framework === f.key));
    const covered = qs.reduce((n, q) => n + (answers[q.id] ? ANSWER_WEIGHT[answers[q.id]!] : 0), 0);
    const openCodes = [...new Set(qs.filter((q) => (answers[q.id] ? ANSWER_WEIGHT[answers[q.id]!] : 0) < 1).flatMap((q) => q.refs.filter((r) => r.framework === f.key).flatMap((r) => r.codes)))];
    return { key: f.key, name: f.name, questions: qs.length, covered, percent: qs.length ? Math.round((covered / qs.length) * 100) : 0, openCodes };
  });
  const gaps = CHECKER_QUESTIONS.filter((q) => (answers[q.id] ? ANSWER_WEIGHT[answers[q.id]!] : 0) < 1).sort((a, b) => (answers[a.id] ? ANSWER_WEIGHT[answers[a.id]!] : 0) - (answers[b.id] ? ANSWER_WEIGHT[answers[b.id]!] : 0));
  return { answered, total, score, level: checkerLevel(score), frameworks, gaps };
}

/** Plain-text summary a visitor can copy into their own notes. */
export function checkerSummaryText(result: CheckerResult, answers: Partial<Record<string, CheckerAnswer>>): string {
  const lines: string[] = [];
  lines.push(`AI agent governance self-check: ${result.score} of 100 (${result.level}), ${result.answered} of ${result.total} questions answered.`);
  lines.push("");
  for (const q of CHECKER_QUESTIONS) lines.push(`[${answers[q.id] ?? "not answered"}] ${q.text}`);
  lines.push("");
  lines.push("Coverage by framework (share of the checker's questions for that framework answered yes):");
  for (const f of result.frameworks) lines.push(`  ${f.name}: ${f.percent}% (${f.questions} questions)${f.openCodes.length ? `, open: ${f.openCodes.join(", ")}` : ""}`);
  lines.push("");
  lines.push("This is a self-assessment against AEGIS's own summaries of public frameworks. It is not a compliance opinion, a certification or legal advice.");
  return lines.join("\n");
}
