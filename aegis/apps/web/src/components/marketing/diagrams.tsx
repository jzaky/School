/* Inline SVG diagrams. Each one carries a <title> and <desc> for assistive technology. */

const C = {
  box: "var(--mk-bg)",
  box2: "var(--mk-bg-2)",
  line: "var(--mk-line-strong)",
  fg: "var(--mk-fg)",
  muted: "var(--mk-muted)",
  dim: "var(--mk-dim)",
  accent: "var(--mk-accent)",
  allow: "var(--mk-allow)",
  deny: "var(--mk-deny)",
  approval: "var(--mk-approval)",
};

function Box({ x, y, w, h, title, lines = [], accent }: { x: number; y: number; w: number; h: number; title: string; lines?: string[]; accent?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={C.box} stroke={accent ? C.accent : C.line} strokeWidth={accent ? 1.8 : 1.2} />
      <text x={x + 14} y={y + 24} fontSize={14} fontWeight={600} fill={C.fg}>
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={i} x={x + 14} y={y + 44 + i * 17} fontSize={12} fill={C.muted}>
          {l}
        </text>
      ))}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, dashed }: { x1: number; y1: number; x2: number; y2: number; dashed?: boolean }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.muted} strokeWidth={1.4} strokeDasharray={dashed ? "4 4" : undefined} markerEnd="url(#mk-arrow)" />;
}

function Defs() {
  return (
    <defs>
      <marker id="mk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill={C.muted} />
      </marker>
    </defs>
  );
}

function Scroll({ children, minWidth }: { children: React.ReactNode; minWidth: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-(--mk-line) bg-(--mk-bg-2) p-3 md:p-5">
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
}

export function SystemShapeDiagram() {
  return (
    <Scroll minWidth={760}>
      <svg className="mk-svg block w-full" viewBox="0 0 960 420" role="img" aria-labelledby="sys-t sys-d">
        <title id="sys-t">AEGIS system shape</title>
        <desc id="sys-d">Three deployable processes (web console, API action gateway, worker) share one domain package and one PostgreSQL database with row-level security plus Redis, all inside the customer deployment boundary. Agents and downstream systems only reach the API gateway.</desc>
        <Defs />
        <rect x={190} y={16} width={754} height={388} rx={14} fill="none" stroke={C.line} strokeDasharray="6 5" />
        <text x={206} y={40} fontSize={12} fill={C.dim}>
          Customer deployment boundary. No outbound calls to AI providers. Telemetry only when an OTLP endpoint is configured.
        </text>
        <Box x={16} y={70} w={150} h={64} title="Console users" lines={["Browser, OIDC SSO, MFA"]} />
        <Box x={16} y={200} w={150} h={96} title="AI agents, SDKs" lines={["Downstream systems", "Integration webhooks", "API keys, HMAC"]} />
        <Box x={220} y={62} w={220} h={80} title="apps/web (Next.js)" lines={["Console and public site", "Server actions import core"]} accent />
        <Box x={220} y={196} w={220} h={104} title="apps/api (Fastify)" lines={["Action Gateway, REST v1", "/v1/gateway, /v1/approvals", "Stateless, scales horizontally"]} accent />
        <Box x={220} y={320} w={220} h={70} title="apps/worker" lines={["Approval expiry, monitoring,", "evidence checkpoints, retention"]} accent />
        <Box x={490} y={62} w={200} h={328} title="packages/core" lines={["identity, orgs, agents", "policy, authz, gateway", "approvals, evidence", "monitoring, shield", "incidents, integrations", "audit, notify, jobs", "", "Every service takes an", "OrgContext and a tenant-", "scoped database handle"]} />
        <Box x={740} y={62} w={190} h={150} title="PostgreSQL 16" lines={["RLS forced on every", "tenant table", "Append-only evidence", "(triggers reject UPDATE", "and DELETE)", "Job queue (SKIP LOCKED)"]} />
        <Box x={740} y={240} w={190} h={64} title="Redis" lines={["Rate limits, live events"]} />
        <Box x={740} y={326} w={190} h={64} title="Volume" lines={["Audit documents never", "leave the deployment"]} />
        <Arrow x1={166} y1={102} x2={218} y2={102} />
        <Arrow x1={166} y1={248} x2={218} y2={248} />
        <Arrow x1={440} y1={102} x2={488} y2={102} />
        <Arrow x1={440} y1={248} x2={488} y2={248} />
        <Arrow x1={440} y1={355} x2={488} y2={355} />
        <Arrow x1={690} y1={137} x2={738} y2={137} />
        <Arrow x1={690} y1={272} x2={738} y2={272} />
        <Arrow x1={690} y1={358} x2={738} y2={358} />
        <text x={480} y={412} fontSize={11} fill={C.dim} textAnchor="middle">
          Two database roles: aegis_app (non-owner, NOBYPASSRLS) for runtime, owner only for migrations
        </text>
      </svg>
    </Scroll>
  );
}

const LANES = [
  { key: "agent", label: "Agent", x: 90 },
  { key: "gateway", label: "Action Gateway", x: 330 },
  { key: "approver", label: "Approver", x: 560 },
  { key: "downstream", label: "Downstream system", x: 760 },
  { key: "evidence", label: "Evidence ledger", x: 940 },
] as const;

type LaneKey = (typeof LANES)[number]["key"];
const lx = (k: LaneKey) => LANES.find((l) => l.key === k)!.x;

const STEPS: { from: LaneKey; to: LaneKey; label: string; sub?: string; tone?: "allow" | "deny" | "approval" }[] = [
  { from: "agent", to: "gateway", label: "POST /v1/gateway/actions", sub: "API key, tool, params, idempotency key" },
  { from: "gateway", to: "gateway", label: "Registry checks", sub: "agent active, tool granted, schema, resource, classification, destination, pause" },
  { from: "gateway", to: "gateway", label: "Shield inspection", sub: "data classes, injection signals, tool security" },
  { from: "gateway", to: "gateway", label: "Policy evaluation", sub: "deny wins, then approval, then allow, else default deny" },
  { from: "gateway", to: "evidence", label: "decision event appended", sub: "same transaction; failure rolls the decision back" },
  { from: "gateway", to: "agent", label: "403 denied", sub: "reasons, matched rule, security event if configured", tone: "deny" },
  { from: "gateway", to: "approver", label: "202 approval required", sub: "approval request with expiry; nothing executes", tone: "approval" },
  { from: "approver", to: "gateway", label: "approve (request hash)", sub: "separation of duties; hash must still match", tone: "approval" },
  { from: "gateway", to: "gateway", label: "Execution grant issued", sub: "single use, 5 minutes, bound to SHA-256 of tool, action, params" },
  { from: "gateway", to: "downstream", label: "execute with grant", sub: "downstream verifies the grant before acting", tone: "allow" },
  { from: "downstream", to: "gateway", label: "receipt TRF-7F3A21C0", sub: "status, downstream reference, summary", tone: "allow" },
  { from: "gateway", to: "evidence", label: "executed event appended", sub: "hash-linked to the previous event" },
  { from: "gateway", to: "agent", label: "200 executed, receipt included", tone: "allow" },
];

export function LifecycleDiagram() {
  const top = 60;
  const rowH = 44;
  const height = top + STEPS.length * rowH + 30;
  return (
    <Scroll minWidth={900}>
      <svg className="mk-svg block w-full" viewBox={`0 0 1040 ${height}`} role="img" aria-labelledby="lc-t lc-d">
        <title id="lc-t">Request lifecycle through the Action Gateway</title>
        <desc id="lc-d">
          Sequence: the agent posts an action request; the gateway runs registry checks, Shield inspection and policy evaluation, appends a decision event to the evidence ledger in the same transaction, then returns 403 denied, 202 approval required or 200 allowed. An approver decides against the request hash; the gateway issues a single-use grant; the downstream system verifies the grant and returns a receipt; an executed event is appended.
        </desc>
        <Defs />
        {LANES.map((l) => (
          <g key={l.key}>
            <rect x={l.x - 70} y={10} width={140} height={32} rx={8} fill={C.box} stroke={l.key === "gateway" ? C.accent : C.line} strokeWidth={l.key === "gateway" ? 1.8 : 1.2} />
            <text x={l.x} y={31} fontSize={13} fontWeight={600} fill={C.fg} textAnchor="middle">
              {l.label}
            </text>
            <line x1={l.x} y1={44} x2={l.x} y2={height - 10} stroke={C.line} strokeDasharray="3 5" />
          </g>
        ))}
        {STEPS.map((s, i) => {
          const y = top + i * rowH + 10;
          const x1 = lx(s.from);
          const x2 = lx(s.to);
          const color = s.tone === "allow" ? C.allow : s.tone === "deny" ? C.deny : s.tone === "approval" ? C.approval : C.muted;
          const self = x1 === x2;
          const mid = self ? x1 + 20 : (x1 + x2) / 2;
          return (
            <g key={i}>
              <text x={16} y={y + 4} fontSize={11} fill={C.dim} className="mono">
                {String(i + 1).padStart(2, "0")}
              </text>
              {self ? (
                <path d={`M ${x1} ${y - 10} h 36 v 20 h -36`} fill="none" stroke={color} strokeWidth={1.4} markerEnd="url(#mk-arrow)" />
              ) : (
                <line x1={x1} y1={y} x2={x2 + (x2 > x1 ? -4 : 4)} y2={y} stroke={color} strokeWidth={1.4} markerEnd="url(#mk-arrow)" />
              )}
              <text x={self ? mid + 26 : mid} y={y - 4} fontSize={12.5} fontWeight={600} fill={C.fg} textAnchor={self ? "start" : "middle"}>
                {s.label}
              </text>
              {s.sub ? (
                <text x={self ? mid + 26 : mid} y={y + 12} fontSize={11} fill={C.muted} textAnchor={self ? "start" : "middle"}>
                  {s.sub}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </Scroll>
  );
}

const CHAIN = [
  { seq: 1041, type: "gateway.decision.require_approval", hash: "9c1e…4a07", prev: "e2b8…71c3" },
  { seq: 1042, type: "approval.requested", hash: "b74d…08f2", prev: "9c1e…4a07" },
  { seq: 1043, type: "approval.decided", hash: "5fa0…d9e6", prev: "b74d…08f2" },
  { seq: 1044, type: "gateway.executed", hash: "c3d1…66ab", prev: "5fa0…d9e6" },
];

export function EvidenceChainDiagram() {
  return (
    <Scroll minWidth={760}>
      <svg className="mk-svg block w-full" viewBox="0 0 960 300" role="img" aria-labelledby="ev-t ev-d">
        <title id="ev-t">Evidence chain with signed checkpoints</title>
        <desc id="ev-d">Each evidence event stores its sequence number, the previous hash and hash = sha256(canonical(event) || prev_hash). A worker signs the latest hash with Ed25519 as a checkpoint whose key lives outside the database. Verification recomputes the chain; rewriting one event breaks every later hash.</desc>
        <Defs />
        {CHAIN.map((e, i) => {
          const x = 20 + i * 232;
          return (
            <g key={e.seq}>
              <rect x={x} y={40} width={200} height={124} rx={10} fill={C.box} stroke={C.line} strokeWidth={1.2} />
              <text x={x + 14} y={64} fontSize={12} fill={C.dim} className="mono">
                seq {e.seq}
              </text>
              <text x={x + 14} y={86} fontSize={12.5} fontWeight={600} fill={C.fg}>
                {e.type}
              </text>
              <text x={x + 14} y={112} fontSize={11.5} fill={C.muted} className="mono">
                prev_hash {e.prev}
              </text>
              <text x={x + 14} y={132} fontSize={11.5} fill={C.accent} className="mono">
                hash {e.hash}
              </text>
              <text x={x + 14} y={152} fontSize={10.5} fill={C.dim}>
                sha256(canonical(event) || prev_hash)
              </text>
              {i < CHAIN.length - 1 ? <Arrow x1={x + 200} y1={102} x2={x + 230} y2={102} /> : null}
            </g>
          );
        })}
        <rect x={716} y={196} width={224} height={84} rx={10} fill={C.box} stroke={C.accent} strokeWidth={1.8} />
        <text x={730} y={220} fontSize={13} fontWeight={600} fill={C.fg}>
          Signed checkpoint
        </text>
        <text x={730} y={240} fontSize={11.5} fill={C.muted}>
          Ed25519 over hash of seq 1044
        </text>
        <text x={730} y={258} fontSize={11.5} fill={C.muted}>
          key outside the database
        </text>
        <text x={730} y={274} fontSize={11.5} fill={C.muted}>
          exportable to customer storage
        </text>
        <Arrow x1={816} y1={166} x2={816} y2={194} />
        <rect x={20} y={196} width={430} height={84} rx={10} fill={C.box2} stroke={C.line} />
        <text x={34} y={220} fontSize={13} fontWeight={600} fill={C.fg}>
          Verification
        </text>
        <text x={34} y={240} fontSize={11.5} fill={C.muted}>
          Recompute every hash from seq 1 and compare with the stored chain and the latest checkpoint signature.
        </text>
        <text x={34} y={258} fontSize={11.5} fill={C.muted}>
          Changing seq 1042 changes its hash, so seq 1043 no longer links and the checkpoint fails.
        </text>
        <text x={34} y={274} fontSize={11.5} fill={C.deny}>
          Tamper-evident, not immutable: an owner-role rewrite plus the signing key is detectable through exported checkpoints.
        </text>
      </svg>
    </Scroll>
  );
}
