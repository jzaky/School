import { metrics as otelMetrics } from "@opentelemetry/api";
import { observeQueryDurations } from "@aegis/db";

/**
 * Production metrics (docs/PERFORMANCE.md). Every instrument records twice: to OpenTelemetry (exported when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set) and to an in-process registry that the API serves in the Prometheus
 * text format at /metrics. The registry is per process; a deployment with several replicas scrapes each one.
 * Labels are low-cardinality by construction: results, statuses, job types and system keys, never ids.
 */

type Labels = Record<string, string>;
const meter = otelMetrics.getMeter("aegis");
const key = (l: Labels) =>
  Object.keys(l)
    .sort()
    .map((k) => `${k}=${l[k]}`)
    .join(",");
const fmtLabels = (l: Labels) => {
  const ks = Object.keys(l).sort();
  return ks.length ? `{${ks.map((k) => `${k}="${String(l[k]).replace(/["\\\n]/g, "_")}"`).join(",")}}` : "";
};

interface Instrument {
  name: string;
  help: string;
  type: "counter" | "histogram" | "gauge";
  render(): string[];
}

const registry = new Map<string, Instrument>();

export class Counter implements Instrument {
  readonly type = "counter" as const;
  private values = new Map<string, { labels: Labels; value: number }>();
  private otel;
  constructor(
    readonly name: string,
    readonly help: string,
  ) {
    this.otel = meter.createCounter(name, { description: help });
    registry.set(name, this);
  }
  inc(labels: Labels = {}, n = 1) {
    const k = key(labels);
    const cur = this.values.get(k) ?? { labels, value: 0 };
    cur.value += n;
    this.values.set(k, cur);
    this.otel.add(n, labels);
  }
  get(labels: Labels = {}) {
    return this.values.get(key(labels))?.value ?? 0;
  }
  total() {
    let t = 0;
    for (const v of this.values.values()) t += v.value;
    return t;
  }
  entries() {
    return [...this.values.values()];
  }
  render() {
    return [...this.values.values()].map((v) => `${this.name}${fmtLabels(v.labels)} ${v.value}`);
  }
}

/** Seconds. Buckets suit request paths from a millisecond to a minute. */
export const DEFAULT_BUCKETS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];
const RESERVOIR = 1024;

export class Histogram implements Instrument {
  readonly type = "histogram" as const;
  private series = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number; recent: number[] }>();
  private otel;
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: number[] = DEFAULT_BUCKETS,
  ) {
    this.otel = meter.createHistogram(name, { description: help, unit: "s" });
    registry.set(name, this);
  }
  observe(seconds: number, labels: Labels = {}) {
    const k = key(labels);
    const s = this.series.get(k) ?? { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0, recent: [] };
    this.buckets.forEach((b, i) => {
      if (seconds <= b) s.counts[i]! += 1;
    });
    s.sum += seconds;
    s.count += 1;
    s.recent.push(seconds);
    if (s.recent.length > RESERVOIR) s.recent.shift();
    this.series.set(k, s);
    this.otel.record(seconds, labels);
  }
  /** Percentiles over the most recent observations (up to 1,024 per label set). */
  summary(labels: Labels = {}) {
    const s = this.series.get(key(labels));
    if (!s || s.count === 0) return null;
    return { count: s.count, mean: s.sum / s.count, ...percentiles(s.recent) };
  }
  summaries() {
    return [...this.series.values()].map((s) => ({ labels: s.labels, count: s.count, mean: s.sum / s.count, ...percentiles(s.recent) }));
  }
  render() {
    const out: string[] = [];
    for (const s of this.series.values()) {
      this.buckets.forEach((b, i) => out.push(`${this.name}_bucket${fmtLabels({ ...s.labels, le: String(b) })} ${s.counts[i]}`));
      out.push(`${this.name}_bucket${fmtLabels({ ...s.labels, le: "+Inf" })} ${s.count}`);
      out.push(`${this.name}_sum${fmtLabels(s.labels)} ${s.sum}`);
      out.push(`${this.name}_count${fmtLabels(s.labels)} ${s.count}`);
    }
    return out;
  }
}

export function percentiles(values: number[]) {
  if (!values.length) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1]! };
}

export class Gauge implements Instrument {
  readonly type = "gauge" as const;
  private values = new Map<string, { labels: Labels; value: number }>();
  private otel;
  constructor(
    readonly name: string,
    readonly help: string,
  ) {
    this.otel = meter.createUpDownCounter(name, { description: help });
    registry.set(name, this);
  }
  add(n: number, labels: Labels = {}) {
    const k = key(labels);
    const cur = this.values.get(k) ?? { labels, value: 0 };
    cur.value += n;
    this.values.set(k, cur);
    this.otel.add(n, labels);
  }
  get(labels: Labels = {}) {
    return this.values.get(key(labels))?.value ?? 0;
  }
  render() {
    return [...this.values.values()].map((v) => `${this.name}${fmtLabels(v.labels)} ${v.value}`);
  }
}

// ---------- the instruments ----------

export const m = {
  gatewayDecisions: new Counter("aegis_gateway_decisions_total", "Gateway decisions by result"),
  gatewayDecisionSeconds: new Histogram("aegis_gateway_decision_seconds", "Time to decide one action request, end to end inside the gateway"),
  policyEvaluationSeconds: new Histogram("aegis_policy_evaluation_seconds", "Time to evaluate the policies that apply to one request", [0.00005, 0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1]),
  gatewayInFlight: new Gauge("aegis_gateway_in_flight", "Gateway decisions being made right now in this process"),
  gatewayOverloaded: new Counter("aegis_gateway_overloaded_total", "Requests refused because this process was already deciding its maximum number of requests"),
  executions: new Counter("aegis_executions_total", "Downstream executions by system and outcome"),
  executionSeconds: new Histogram("aegis_execution_seconds", "Time a downstream system took to execute an allowed action"),
  circuitOpen: new Counter("aegis_circuit_opened_total", "Times a circuit breaker opened, by kind"),
  circuitRejected: new Counter("aegis_circuit_rejected_total", "Calls refused at once because a circuit was open, by kind"),
  deliveries: new Counter("aegis_destination_deliveries_total", "Event destination delivery attempts by kind and outcome"),
  jobs: new Counter("aegis_jobs_total", "Background jobs by type and outcome"),
  jobSeconds: new Histogram("aegis_job_seconds", "Time a background job took to run, by type"),
  jobWaitSeconds: new Histogram("aegis_job_wait_seconds", "Time between a job becoming due and a worker starting it, by type"),
  jobsDeadLettered: new Counter("aegis_jobs_dead_lettered_total", "Jobs moved to the dead-letter state after their last attempt, by type"),
  approvalDelaySeconds: new Histogram("aegis_approval_delay_seconds", "Time from an approval request to the person's decision", [1, 10, 30, 60, 300, 900, 1800, 3600, 4 * 3600, 24 * 3600]),
  evidenceAppended: new Counter("aegis_evidence_appended_total", "Evidence events appended to the ledger"),
  dbQuerySeconds: new Histogram("aegis_db_query_seconds", "Database query duration as reported by the database client"),
  httpRequests: new Counter("aegis_http_requests_total", "API requests by route group and status class"),
  httpRequestSeconds: new Histogram("aegis_http_request_seconds", "API request duration by route group"),
  connectorSyncs: new Counter("aegis_connector_syncs_total", "Enterprise connector sync runs by connector and outcome"),
  connectorRecords: new Counter("aegis_connector_records_total", "Records read from an enterprise connector by connector and kind"),
  connectorRetries: new Counter("aegis_connector_retries_total", "Retried connector requests by connector and reason"),
};

observeQueryDurations((ms) => m.dbQuerySeconds.observe(ms / 1000));

/** The whole registry in the Prometheus text exposition format (version 0.0.4). */
export function prometheusText(): string {
  const lines: string[] = [];
  for (const i of registry.values()) {
    lines.push(`# HELP ${i.name} ${i.help}`);
    lines.push(`# TYPE ${i.name} ${i.type}`);
    lines.push(...i.render());
  }
  return `${lines.join("\n")}\n`;
}

/** Elapsed seconds since a process.hrtime.bigint() start. */
export function secondsSince(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e9;
}
