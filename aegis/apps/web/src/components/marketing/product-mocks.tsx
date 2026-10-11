/* Screenshot-style illustrations of console screens, built from HTML and CSS. No raster images. Values are synthetic. */

function Dot({ color }: { color: string }) {
  return <span className="mk-dot" style={{ background: color }} aria-hidden />;
}

const ALLOW = "#2fbf71";
const DENY = "#e5484d";
const APPROVAL = "#f5a524";
const ACCENT = "#5b8def";

export function GatewayMock() {
  const rows = [
    ["12:41:09", "treasury-transfer-agent", "initiate-transfer", "AED 250,000", "Approval required", APPROVAL],
    ["12:40:52", "support-refund-agent", "issue-refund", "AED 180", "Executed", ALLOW],
    ["12:40:31", "marketing-outreach-agent", "export-customer-records", "gold-tier", "Denied", DENY],
    ["12:39:58", "kyc-document-agent", "query-crm", "CUST-88213", "Executed", ALLOW],
    ["12:39:40", "support-refund-agent", "issue-refund", "AED 6,200", "Denied", DENY],
  ];
  return (
    <figure className="mk-mock" role="img" aria-label="Illustration of the Action Gateway live activity table with allowed, denied and approval-required rows">
      <div className="mk-mock-bar">
        <span className="font-semibold text-[#e6ebf5]">Action Gateway</span>
        <span className="rounded bg-[#182236] px-1.5 py-0.5 text-[10px]">production</span>
        <span className="ms-auto rounded border border-[#f5a524]/40 px-1.5 py-0.5 text-[10px] text-[#f5a524]">Demo data</span>
      </div>
      <div className="mk-mock-row grid-cols-[56px_1fr_1fr_84px_120px] text-[10px] uppercase tracking-wider text-[#5f6d87]">
        <span>Time</span>
        <span>Agent</span>
        <span>Tool</span>
        <span className="text-end">Amount</span>
        <span>Status</span>
      </div>
      {rows.map((r) => (
        <div key={r[0]} className="mk-mock-row grid-cols-[56px_1fr_1fr_84px_120px]">
          <span className="font-mono text-[#93a1ba]">{r[0]}</span>
          <span className="truncate">{r[1]}</span>
          <span className="truncate font-mono text-[#93a1ba]">{r[2]}</span>
          <span className="text-end tabular">{r[3]}</span>
          <span className="flex items-center gap-1.5">
            <Dot color={r[5]!} />
            {r[4]}
          </span>
        </div>
      ))}
    </figure>
  );
}

export function ApprovalMock() {
  return (
    <figure className="mk-mock" role="img" aria-label="Illustration of an approval request in the Approval Center with request hash, deciding rule and approve or reject controls">
      <div className="mk-mock-bar">
        <span className="font-semibold text-[#e6ebf5]">Approval Center</span>
        <span className="ms-auto flex items-center gap-1.5 text-[#f5a524]">
          <Dot color={APPROVAL} />
          Pending, expires in 3h 52m
        </span>
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-[#93a1ba]">Treasury Transfer Agent wants to initiate-transfer</p>
          <p className="font-semibold">AED 250,000.00 to AE45 0030 0000 9876 5432 100</p>
          <p className="text-[#93a1ba]">Justification: Treasury ticket TR-2302, quarterly supplier settlement</p>
          <p className="font-mono text-[10px] text-[#5f6d87]">requestHash 3b9f0c…e41a</p>
        </div>
        <div className="space-y-1.5 rounded-lg border border-[#223049] bg-[#111826] p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-[#5f6d87]">Deciding rule</p>
          <p className="font-mono text-[#7aa3ff]">treasury-transfer-limits v1 / manager-50k-1m</p>
          <p className="text-[#93a1ba]">params.amount between [50000, 1000000]: 250000, true</p>
          <p className="text-[#93a1ba]">Separation of duties: agent owners excluded</p>
        </div>
      </div>
      <div className="flex gap-2 border-t border-[#1a2436] p-3">
        <span className="rounded-md bg-[#2fbf71] px-2.5 py-1 text-[11px] font-semibold text-white">Approve</span>
        <span className="rounded-md border border-[#2f4166] px-2.5 py-1 text-[11px]">Reject</span>
        <span className="rounded-md border border-[#2f4166] px-2.5 py-1 text-[11px]">Request info</span>
        <span className="rounded-md border border-[#2f4166] px-2.5 py-1 text-[11px]">Escalate</span>
      </div>
    </figure>
  );
}

export function EvidenceMock() {
  const rows = [
    ["1044", "gateway.executed", "action_request", "c3d1…66ab"],
    ["1043", "approval.decided", "approval_request", "5fa0…d9e6"],
    ["1042", "approval.requested", "approval_request", "b74d…08f2"],
    ["1041", "gateway.decision.require_approval", "action_request", "9c1e…4a07"],
    ["1040", "shield.security_event", "security_event", "e2b8…71c3"],
  ];
  return (
    <figure className="mk-mock" role="img" aria-label="Illustration of the Evidence Ledger with chain status valid, a signed checkpoint and hash-linked events">
      <div className="mk-mock-bar">
        <span className="font-semibold text-[#e6ebf5]">Evidence Ledger</span>
        <span className="flex items-center gap-1.5 text-[#2fbf71]">
          <Dot color={ALLOW} />
          Chain valid through seq 1044
        </span>
        <span className="ms-auto text-[#93a1ba]">Checkpoint signed 2 min ago</span>
      </div>
      <div className="mk-mock-row grid-cols-[48px_1fr_120px_96px] text-[10px] uppercase tracking-wider text-[#5f6d87]">
        <span>Seq</span>
        <span>Type</span>
        <span>Subject</span>
        <span>Hash</span>
      </div>
      {rows.map((r) => (
        <div key={r[0]} className="mk-mock-row grid-cols-[48px_1fr_120px_96px]">
          <span className="font-mono text-[#93a1ba]">{r[0]}</span>
          <span className="truncate font-mono">{r[1]}</span>
          <span className="truncate text-[#93a1ba]">{r[2]}</span>
          <span className="font-mono text-[#7aa3ff]">{r[3]}</span>
        </div>
      ))}
    </figure>
  );
}

export function MonitoringMock() {
  const rows = [
    ["RM-002", "Permission escalation attempts", "marketing-outreach-agent", "high", DENY],
    ["RM-001", "Repeated denied actions", "support-refund-agent", "medium", APPROVAL],
    ["RM-009", "Approvals about to expire", "2 requests within 60 min", "low", ACCENT],
    ["RM-010", "Chain integrity", "verified, no finding", "info", ALLOW],
  ];
  return (
    <figure className="mk-mock" role="img" aria-label="Illustration of Risk Monitoring alerts produced by deterministic rules">
      <div className="mk-mock-bar">
        <span className="font-semibold text-[#e6ebf5]">Risk Monitoring</span>
        <span className="ms-auto text-[#93a1ba]">11 rules, evaluated every minute</span>
      </div>
      {rows.map((r) => (
        <div key={r[0]} className="mk-mock-row grid-cols-[52px_1fr_1fr_64px]">
          <span className="font-mono text-[#93a1ba]">{r[0]}</span>
          <span className="truncate">{r[1]}</span>
          <span className="truncate text-[#93a1ba]">{r[2]}</span>
          <span className="flex items-center gap-1.5">
            <Dot color={r[4]!} />
            {r[3]}
          </span>
        </div>
      ))}
    </figure>
  );
}

export function ShieldMock() {
  return (
    <figure className="mk-mock" role="img" aria-label="Illustration of a Shield inspection result: card number and IBAN detected, email to an external domain blocked">
      <div className="mk-mock-bar">
        <span className="font-semibold text-[#e6ebf5]">Data Protection</span>
        <span className="ms-auto flex items-center gap-1.5 text-[#e5484d]">
          <Dot color={DENY} />
          Blocked
        </span>
      </div>
      <div className="space-y-2 p-3">
        <p className="text-[#93a1ba]">send-email to agency@partner-upload.example</p>
        <p className="rounded-md border border-[#223049] bg-[#111826] p-2 font-mono text-[11px] leading-5">
          Customer 1: Ahmed, card <mark className="rounded bg-[#e5484d]/25 px-1 text-[#ffb3b5]">4111 1111 1111 1111</mark>, IBAN <mark className="rounded bg-[#e5484d]/25 px-1 text-[#ffb3b5]">AE07 0331 2345 6789 0123 456</mark>
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <p>
            <span className="text-[#5f6d87]">card_number</span> Luhn valid, severity high, action block
          </p>
          <p>
            <span className="text-[#5f6d87]">iban</span> mod-97 valid, severity high, action block
          </p>
          <p>
            <span className="text-[#5f6d87]">destination</span> partner-upload.example not in allowlist
          </p>
          <p>
            <span className="text-[#5f6d87]">policy</span> customer-data-egress / no-sensitive-in-email
          </p>
        </div>
      </div>
    </figure>
  );
}

export function ToolSecurityMock() {
  const rows = [
    ["send-email", "medium", "*.meridian-demo.example", "enabled"],
    ["export-customer-records", "critical", "warehouse.meridian-demo.example", "enabled"],
    ["initiate-transfer", "critical", "resource payments-core only", "enabled"],
    ["http-request", "high", "api.fx-rates.example", "enabled"],
  ];
  return (
    <figure className="mk-mock" role="img" aria-label="Illustration of the Tool Security overview with risk level and destination allowlist per tool">
      <div className="mk-mock-bar">
        <span className="font-semibold text-[#e6ebf5]">Tool Security</span>
      </div>
      <div className="mk-mock-row grid-cols-[1fr_64px_1fr_64px] text-[10px] uppercase tracking-wider text-[#5f6d87]">
        <span>Tool</span>
        <span>Risk</span>
        <span>Destination rules</span>
        <span>State</span>
      </div>
      {rows.map((r) => (
        <div key={r[0]} className="mk-mock-row grid-cols-[1fr_64px_1fr_64px]">
          <span className="truncate font-mono">{r[0]}</span>
          <span className="text-[#93a1ba]">{r[1]}</span>
          <span className="truncate font-mono text-[#93a1ba]">{r[2]}</span>
          <span className="text-[#2fbf71]">{r[3]}</span>
        </div>
      ))}
    </figure>
  );
}

export function AssessmentMock() {
  const rows = [
    ["A.5.15", "Access control", "Supported", "Access control policy v3, section 4", ALLOW],
    ["A.8.15", "Logging", "Supported", "Automated evidence: evidence_ledger", ALLOW],
    ["A.5.24", "Incident planning", "Partial", "Procedure found; roles missing", APPROVAL],
    ["A.8.9", "Configuration management", "Not found", "No matching passage", DENY],
  ];
  return (
    <figure className="mk-mock" role="img" aria-label="Illustration of an Audit assessment: controls with finding status and the passage or automated evidence that supports each">
      <div className="mk-mock-bar">
        <span className="font-semibold text-[#e6ebf5]">Assessment</span>
        <span className="text-[#93a1ba]">ISO/IEC 27001:2022 Annex A, 3 documents</span>
        <span className="ms-auto text-[#93a1ba]">lexical similarity, not conformance</span>
      </div>
      <div className="mk-mock-row grid-cols-[52px_1fr_80px_1fr] text-[10px] uppercase tracking-wider text-[#5f6d87]">
        <span>Control</span>
        <span>Name</span>
        <span>Finding</span>
        <span>Basis</span>
      </div>
      {rows.map((r) => (
        <div key={r[0]} className="mk-mock-row grid-cols-[52px_1fr_80px_1fr]">
          <span className="font-mono text-[#93a1ba]">{r[0]}</span>
          <span className="truncate">{r[1]}</span>
          <span className="flex items-center gap-1.5">
            <Dot color={r[4]!} />
            {r[2]}
          </span>
          <span className="truncate text-[#93a1ba]">{r[3]}</span>
        </div>
      ))}
    </figure>
  );
}
