import type { EvaluationResult, PolicyToEvaluate } from "./evaluate.js";

/**
 * EXPERIMENTAL. Evaluates against an external Open Policy Agent server using its documented
 * Data API (POST /v1/data/<path> with {"input": ...}). The Rego package is expected to return
 * {"result": "allow"|"deny"|"require_approval", "reasons": [...], "rule": "..."}.
 *
 * This adapter is not exercised by the test suite in this build: the OPA binary could not be
 * downloaded in the development environment. The built-in deterministic evaluator is the default
 * and is the only evaluator the authorization tests cover. Enable with POLICY_EVALUATOR=opa and OPA_URL.
 */
export interface PolicyEvaluator {
  name: string;
  evaluate(policies: PolicyToEvaluate[], input: unknown): Promise<EvaluationResult>;
}

export class OpaEvaluator implements PolicyEvaluator {
  name = "opa-experimental";
  constructor(private readonly baseUrl: string, private readonly dataPath = "aegis/authz", private readonly timeoutMs = 2000) {}

  async evaluate(policies: PolicyToEvaluate[], input: unknown): Promise<EvaluationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/data/${this.dataPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { ...(input as Record<string, unknown>), policies: policies.map((p) => ({ key: p.policyKey, version: p.policyVersion, document: p.document })) } }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OPA returned ${res.status}`);
      const body = (await res.json()) as { result?: { result?: string; reasons?: string[]; rule?: string } };
      const r = body.result?.result;
      const result = r === "allow" || r === "require_approval" ? r : "deny";
      return {
        result,
        decidingRule: null,
        matchedRules: [],
        trace: [],
        skippedPolicies: [],
        approval: null,
        riskIndicators: [],
        reasons: body.result?.reasons ?? [body.result?.rule ?? "opa decision"],
        securityEventSeverity: null,
        defaultDeny: r === undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
