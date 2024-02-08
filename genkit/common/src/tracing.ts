import { MetricExporter } from "@google-cloud/opentelemetry-cloud-monitoring-exporter";
import { GcpDetectorSync } from "@google-cloud/opentelemetry-resource-util";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { Resource } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { meterProvider } from "./metrics";
import { getProjectId } from "./runtime";
import { TraceStore } from "./tracing";
import { TraceStoreExporter } from "./tracing/exporter";

export * from "./tracing/exporter";
export * from "./tracing/firestoreTraceStore";
export * from "./tracing/instrumentation";
export * from "./tracing/localFileTraceStore";
export * from "./tracing/processor";
export * from "./tracing/types";

const processors: SpanProcessor[] = [];

/**
 *
 */
export function enableTracingAndMetrics(
  options: { projId?: string; processor: "batch" | "simple" } = {
    processor: "batch",
  }
) {
  if (!options.projId) {
    options.projId = getProjectId();
  }

  const contextManager = new AsyncLocalStorageContextManager(); // this contextManager is not required if we do not want to invoke sdk#configureTracerProvider - can be removed
  contextManager.enable();

  const traceStore = getGlobalTraceStore();
  const exporter = new TraceStoreExporter(traceStore);
  const spanProcessor =
    options.processor === "batch"
      ? new BatchSpanProcessor(exporter)
      : new SimpleSpanProcessor(exporter);

  processors.push(spanProcessor);

  const metricReader = new PeriodicExportingMetricReader({
    // Export metrics every 10 seconds. 5 seconds is the smallest sample period allowed by
    // Cloud Monitoring.
    exportIntervalMillis: 10_000,
    exporter: new MetricExporter(),
  }) as any;
  meterProvider.addMetricReader(metricReader);

  const resource = new Resource({
    type: "global",
  }).merge(new GcpDetectorSync().detect());

  const sdk = new NodeSDK({
    resource,
    // TODO: fix this hack (any), SpanProcessor type does not resolve, suspect workspace deps issue
    spanProcessor: spanProcessor as any, 
    contextManager,
  });
  sdk.start();
}

/**
 *
 */
export async function flushTracing() {
  await Promise.all(processors.map((p) => p.forceFlush()));
}

let traceStore: TraceStore;

export function setGlobalTraceStore(store: TraceStore) {
  traceStore = store;
}

export function getGlobalTraceStore(): TraceStore {
  if (!traceStore) {
    throw new Error("setGlobalTraceStore has not been called, yet")
  }
  return traceStore;
}