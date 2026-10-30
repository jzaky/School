import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";

export interface ExpenseClaimRow {
  id: string;
  ref: string;
  claimantRef: string;
  merchantName: string;
  currency: string;
  total: string;
  verdict: "verified_match" | "requires_review" | "confirmed_mismatch" | "insufficient_evidence";
  /** The first finding that decided the verdict, in plain words. */
  reason: string | null;
}

const VERDICT = {
  verified_match: { label: "Matches the card", tone: "allow" },
  requires_review: { label: "Needs a person", tone: "approval" },
  confirmed_mismatch: { label: "Does not match", tone: "deny" },
  insufficient_evidence: { label: "Nothing to check against", tone: "neutral" },
} as const;

/** Read-only view of receipt validation; claims and card transactions come from the expense system and the card feed. */
export function ExpenseClaims({ claims }: { claims: ExpenseClaimRow[] }) {
  const counts = claims.reduce<Record<string, number>>((a, c) => ({ ...a, [c.verdict]: (a[c.verdict] ?? 0) + 1 }), {});
  return (
    <Panel title="Receipt validation" description="Expense receipts are checked against what the claimant cannot edit: the card or bank transaction, earlier claims and the receipt's own VAT arithmetic. AI-generated image labels are shown to a person and never decide a claim alone. Agents cannot submit claims.">
      {claims.length === 0 ? (
        <p className="text-sm text-fg-muted">No expense claims yet. The expense system submits them with the API (POST /v1/expenses/claims), after the card feed registers transactions (POST /v1/expenses/transactions).</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-fg-muted" data-testid="claim-counts">
            {(Object.keys(VERDICT) as (keyof typeof VERDICT)[])
              .filter((k) => counts[k])
              .map((k) => `${VERDICT[k].label}: ${counts[k]}`)
              .join(" · ")}
          </p>
          <ul className="space-y-1.5 text-sm" data-testid="expense-claims">
            {claims.slice(0, 8).map((c) => (
              <li key={c.id} className="border-t border-line pt-1.5 first:border-0 first:pt-0" data-testid="expense-claim">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-mono text-xs">{c.ref}</span> <span className="text-fg-muted">{c.merchantName} · {c.currency} {c.total}</span>
                  </span>
                  <Badge tone={VERDICT[c.verdict].tone}>{VERDICT[c.verdict].label}</Badge>
                </div>
                {c.reason ? <p className="mt-0.5 text-xs text-fg-muted">{c.reason}</p> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
