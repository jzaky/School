import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";

export interface PaymentDocRow {
  id: string;
  ref: string;
  kind: string;
  vendorRef: string;
  amount: number;
  currency: string;
  state: "open" | "in_progress" | "paid" | "void";
  source: string;
}

const STATE = { open: { label: "Open", tone: "info" }, in_progress: { label: "Being paid", tone: "approval" }, paid: { label: "Paid", tone: "allow" }, void: { label: "Void", tone: "neutral" } } as const;

/** Read-only view of payment document matching; documents come from the system of record through the API. */
export function PaymentMatching({ tools, documents }: { tools: { key: string; documentParam: string; kinds: string[]; effect: string }[]; documents: PaymentDocRow[] }) {
  return (
    <Panel title="Payment matching" description="Payment tools with matching on can pay only against an invoice, receipt or purchase order registered by the system of record: same payee, same amount, never twice. Agents cannot register documents.">
      {tools.length === 0 ? (
        <p className="text-sm text-fg-muted">No payment tool has matching on. Turn it on for a tool with the API (POST /v1/payment-documents/tools/:toolId/matching).</p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm" data-testid="matching-tools">
          {tools.map((t) => (
            <li key={t.key}>
              <span className="font-mono text-xs">{t.key}</span> <span className="text-fg-muted">matches {t.documentParam} against a registered {t.kinds.join(" or ")}; a mismatch is {t.effect === "deny" ? "refused" : "held for a person"}</span>
            </li>
          ))}
        </ul>
      )}
      {documents.length === 0 ? (
        <p className="text-sm text-fg-muted">No documents registered yet.</p>
      ) : (
        <ul className="space-y-1.5 text-sm" data-testid="payment-documents">
          {documents.slice(0, 8).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-1.5 first:border-0 first:pt-0" data-testid="payment-document">
              <span>
                <span className="font-mono text-xs">{d.ref}</span> <span className="text-fg-muted">{d.vendorRef} · {d.currency} {d.amount.toLocaleString("en-US")}</span>
              </span>
              <Badge tone={STATE[d.state].tone}>{STATE[d.state].label}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
