import { metrics, trace, type Span } from "@opentelemetry/api";
import { env } from "../env.js";

/**
 * OpenTelemetry bootstrap. Export is enabled only when OTEL_EXPORTER_OTLP_ENDPOINT is set
 * (SigNoz, an OTLP collector, or any compatible backend). Without it, spans and metrics are
 * no-ops with zero overhead beyond the API calls. Call once at process start.
 */
let started = false;
export async function startTelemetry(component: string): Promise<{ shutdown: () => Promise<void> }> {
  if (started || !env().OTEL_EXPORTER_OTLP_ENDPOINT) return { shutdown: async () => undefined };
  started = true;
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
  const { PeriodicExportingMetricReader } = await import("@opentelemetry/sdk-metrics");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const base = env().OTEL_EXPORTER_OTLP_ENDPOINT!.replace(/\/$/, "");
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": `${env().OTEL_SERVICE_NAME}-${component}`, "deployment.environment": env().NODE_ENV }),
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }), exportIntervalMillis: 30_000 }),
  });
  sdk.start();
  return { shutdown: () => sdk.shutdown() };
}

export const tracer = trace.getTracer("aegis");
export const meter = metrics.getMeter("aegis");
export const decisionCounter = meter.createCounter("aegis.gateway.decisions", { description: "Authorization decisions by result" });
export const decisionLatency = meter.createHistogram("aegis.gateway.decision_latency_ms", { description: "Decision latency in milliseconds" });

/** Runs fn inside a span; records the error and rethrows. Never swallows. */
export async function withSpan<T>(name: string, attributes: Record<string, string | number | boolean>, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (e) {
      span.recordException(e instanceof Error ? e : new Error(String(e)));
      span.setStatus({ code: 2, message: e instanceof Error ? e.message : "error" });
      throw e;
    } finally {
      span.end();
    }
  });
}

export function currentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
}
