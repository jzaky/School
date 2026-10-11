/**
 * Prompt-injection SIGNALS.
 *
 * These are heuristic pattern matches over text that may have been written by an attacker
 * (retrieved documents, emails, ticket bodies, tool parameters that embed such text). They are
 * labelled `heuristic: true` everywhere and feed `shield.injectionSignals` in the policy input so
 * policies and analysts can react. They are NOT prevention: enforcement in AEGIS is the gateway's
 * registry (granted tools, destination allowlists, resource permissions) and the policies, none of
 * which read model text. False negatives are expected; see docs/THREAT_MODEL.md T5.
 */

export type InjectionSignalKey = "instruction_override" | "role_hijack" | "exfiltration_request" | "tool_coercion" | "hidden_text" | "encoded_payload" | "urgency_pressure";

export interface InjectionSignal {
  key: InjectionSignalKey;
  /** Matched phrase, truncated. Never the whole text. */
  snippet: string;
  /** Heuristic strength of this match. */
  confidence: number;
}

export interface InjectionReport {
  signals: InjectionSignal[];
  keys: InjectionSignalKey[];
  heuristic: true;
}

export type Provenance = "trusted" | "untrusted" | "retrieved";

const SNIPPET_MAX = 80;

interface SignalRule {
  key: InjectionSignalKey;
  patterns: { re: RegExp; confidence: number }[];
}

const RULES: SignalRule[] = [
  {
    key: "instruction_override",
    patterns: [
      { re: /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|your|the)\b[^.\n]{0,30}\b(?:instructions?|rules?|guidelines?|policies|policy|constraints?|prompt|directives?|guardrails?|restrictions?|safety)\b/i, confidence: 0.9 },
      { re: /\bdisregard your\b/i, confidence: 0.8 },
      { re: /\byou are now\b[^.\n]{0,60}/i, confidence: 0.7 },
      { re: /\bnew instructions?\s*:/i, confidence: 0.85 },
      { re: /\bfrom now on\b[^.\n]{0,40}\b(?:you|ignore|always|never|must)\b/i, confidence: 0.6 },
      { re: /\b(?:do not|don't|never)\s+follow\b[^.\n]{0,30}\b(?:instructions?|rules?|policy|policies)\b/i, confidence: 0.8 },
      { re: /\b(?:your|the)\s+(?:real|true|actual|new)\s+(?:task|goal|instructions?|objective)\s+(?:is|are)\b/i, confidence: 0.75 },
    ],
  },
  {
    key: "role_hijack",
    patterns: [
      { re: /(?:^|\n|\s)(?:system|assistant|developer)\s*:\s*\S/i, confidence: 0.7 },
      { re: /<\|?(?:im_start|im_end|system|endoftext)\|?>/i, confidence: 0.85 },
      { re: /\[(?:SYSTEM|INST|\/INST|ADMIN)\]/, confidence: 0.8 },
      { re: /\b(?:act|behave|pretend|roleplay|role-play)\s+as\s+(?:an?\s+)?(?:unrestricted|unfiltered|jailbroken|admin|administrator|root|developer|system|different|new)\b/i, confidence: 0.8 },
      { re: /\bact as\b[^.\n]{0,40}\b(?:without|no)\s+(?:restrictions?|limits?|rules?|filters?)\b/i, confidence: 0.85 },
      { re: /\b(?:developer|god|dan|jailbreak|debug)\s+mode\b/i, confidence: 0.7 },
    ],
  },
  {
    key: "exfiltration_request",
    patterns: [
      { re: /\b(?:send|upload|email|e-mail|forward|post|transmit|export|copy|exfiltrate|leak|share|dump|transfer)\b[^.\n]{0,60}\b(?:all|every|entire|full|complete|the)?\s*(?:customer|client|user|employee|account|card|password|credential|secret|api[- ]?key|token|database|records?|data|list|file|contents?|conversation|history|prompt|instructions?)\b[^.\n]{0,60}\b(?:to|at|into)\s+(?:https?:\/\/|www\.|[\w.-]+@[\w.-]+\.\w+|(?:an?\s+)?(?:external|outside|this|the following|my|our|that)\s+(?:address|url|server|endpoint|webhook|bucket|drive|email|inbox|domain|site|link))/i, confidence: 0.9 },
      { re: /\b(?:send|upload|post|forward|email)\b[^.\n]{0,40}\bto\s+(?:https?:\/\/[^\s]+|[\w.-]+@[\w.-]+\.\w+)/i, confidence: 0.7 },
      { re: /\b(?:reveal|print|show|output|repeat|display)\b[^.\n]{0,30}\b(?:system prompt|hidden instructions|your instructions|api[- ]?keys?|credentials|secrets?|passwords?)\b/i, confidence: 0.85 },
      { re: /\b(?:include|attach|append|embed)\b[^.\n]{0,40}\b(?:credentials|password|api[- ]?key|token|secret|customer (?:data|list|records))\b[^.\n]{0,40}\b(?:in|to)\s+(?:the|your)\s+(?:reply|response|email|message|output)/i, confidence: 0.8 },
    ],
  },
  {
    key: "tool_coercion",
    patterns: [
      { re: /\b(?:call|invoke|run|execute|trigger|use)\s+(?:the\s+)?(?:tool|function|action|command)\b/i, confidence: 0.75 },
      { re: /\b(?:call|invoke|run|execute|trigger|use)\s+(?:the\s+)?[`"']?(?:export|transfer|delete|drop|wire|payout|refund|send[-_ ]?email|http[-_ ]?request|initiate[-_ ]?transfer|export[-_ ]?customer[-_ ]?records|run[-_ ]?warehouse[-_ ]?query)\b/i, confidence: 0.85 },
      { re: /\b(?:initiate|issue|approve|authorize|authorise)\s+(?:a\s+|the\s+)?(?:transfer|payment|wire|payout|refund)\b[^.\n]{0,40}\b(?:without|skip|bypass|no)\s+(?:approval|review|verification|checks?|confirmation)/i, confidence: 0.9 },
      { re: /\bset\s+(?:the\s+)?(?:destination|recipient|url|endpoint|account)\s+to\b/i, confidence: 0.6 },
      { re: /\btool[_ ]?call\s*[:=]/i, confidence: 0.7 },
    ],
  },
  {
    key: "encoded_payload",
    patterns: [{ re: /(?<![A-Za-z0-9+/=])(?:[A-Za-z0-9+/]{4}){20,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?(?![A-Za-z0-9+/=])/, confidence: 0.6 }],
  },
];

const URGENCY_STRONG: RegExp[] = [/\b(?:do not|don't|never|without)\s+(?:tell|inform|notify|alert|mention|report)\b[^.\n]{0,30}\b(?:anyone|anybody|the user|your (?:operator|owner|admin)|security|compliance|humans?|them)\b/i, /\bkeep (?:this|it) (?:a )?(?:secret|confidential|between us|quiet)\b/i, /\bbefore (?:anyone|someone|they|the (?:team|admin|user)) (?:notices?|finds? out|sees?|checks?)\b/i, /\bthis is (?:an? )?(?:emergency|urgent)\b[^.\n]{0,40}\b(?:skip|bypass|ignore|no time for)\b/i, /\b(?:no time|there is no time) (?:for|to)\s+(?:approval|review|checks?|verification)\b/i];
const URGENCY_WEAK: RegExp[] = [/\bimmediately\b/i, /\bright now\b/i, /\burgent(?:ly)?\b/i, /\bsecret(?:ly)?\b/i, /\bas soon as possible\b/i, /\basap\b/i];

// eslint-disable-next-line no-irregular-whitespace -- the detector targets these invisible characters on purpose
const ZERO_WIDTH = /[​-‏⁠﻿‪-‮⁦-⁩]/g;
const UNICODE_TAGS = /[\u{E0000}-\u{E007F}]/gu;
const HTML_COMMENT = /<!--[\s\S]{1,2000}?-->/g;

function snippet(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX - 3)}...` : t;
}

/** Returns heuristic signals found in `text`. Deterministic. Never throws on any string input. */
export function detectInjectionSignals(text: string): InjectionReport {
  const signals: InjectionSignal[] = [];
  if (typeof text !== "string" || text.length === 0) return { signals, keys: [], heuristic: true };
  const input = text.length > 200_000 ? text.slice(0, 200_000) : text;
  const plain = input.replace(ZERO_WIDTH, "");

  for (const rule of RULES) {
    for (const p of rule.patterns) {
      const m = p.re.exec(plain);
      if (m) signals.push({ key: rule.key, snippet: snippet(m[0]), confidence: p.confidence });
    }
  }

  // hidden_text: zero-width characters, unicode tag characters, HTML comments.
  const zw = input.match(ZERO_WIDTH);
  if (zw && zw.length >= 1) signals.push({ key: "hidden_text", snippet: `${zw.length} zero-width or bidi control character(s)`, confidence: zw.length >= 3 ? 0.9 : 0.6 });
  const tags = input.match(UNICODE_TAGS);
  if (tags && tags.length >= 3) signals.push({ key: "hidden_text", snippet: `${tags.length} unicode tag characters`, confidence: 0.9 });
  const comments = plain.match(HTML_COMMENT);
  if (comments && comments.length > 0) signals.push({ key: "hidden_text", snippet: snippet(comments[0]!), confidence: 0.6 });

  // urgency_pressure: strong phrases alone; weak words only when another signal is present.
  const strong = URGENCY_STRONG.map((re) => re.exec(plain)).find(Boolean);
  if (strong) signals.push({ key: "urgency_pressure", snippet: snippet(strong[0]), confidence: 0.75 });
  else if (signals.length > 0) {
    const weak = URGENCY_WEAK.map((re) => re.exec(plain)).find(Boolean);
    if (weak) signals.push({ key: "urgency_pressure", snippet: snippet(weak[0]), confidence: 0.4 });
  }

  const keys = [...new Set(signals.map((s) => s.key))];
  return { signals, keys, heuristic: true };
}

/**
 * Scans content according to its provenance. Trusted content (written by the operator, for
 * example the agent's own system prompt or the tool manifest) is not scanned: it is expected to
 * contain instructions. Untrusted and retrieved content is where injected instructions arrive.
 */
export function inspectUntrustedContent(input: { text: string; provenance: Provenance }): InjectionReport & { provenance: Provenance; scanned: boolean } {
  if (input.provenance === "trusted") return { signals: [], keys: [], heuristic: true, provenance: input.provenance, scanned: false };
  return { ...detectInjectionSignals(input.text), provenance: input.provenance, scanned: true };
}

/** Walks parameters and runs the signal detector over every string longer than `minLength`. */
export function detectInjectionInParams(params: Record<string, unknown>, minLength = 20): InjectionReport & { fields: { field: string; keys: InjectionSignalKey[] }[] } {
  const signals: InjectionSignal[] = [];
  const fields: { field: string; keys: InjectionSignalKey[] }[] = [];
  const visit = (v: unknown, path: string, depth: number) => {
    if (depth > 32) return;
    if (typeof v === "string") {
      if (v.length <= minLength) return;
      const r = detectInjectionSignals(v);
      if (r.signals.length > 0) {
        signals.push(...r.signals);
        fields.push({ field: path, keys: r.keys });
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`, depth + 1));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) visit(x, path ? `${path}.${k}` : k, depth + 1);
  };
  visit(params ?? {}, "", 0);
  return { signals, keys: [...new Set(signals.map((s) => s.key))], heuristic: true, fields };
}
