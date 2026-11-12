import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { SERVICE_NAME, UNTRACED_PATHS } from './names';

// Must run before express, pg and @nestjs/core are required: the
// instrumentations patch modules on load. main.ts imports this file first.

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

// No endpoint still gives every request a trace id for the logs; spans just
// are not exported anywhere.
const provider = new TracerProvider({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
  spanProcessors: endpoint
    ? [new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })]
    : [],
});

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(
  new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  }),
);
trace.setGlobalTracerProvider(provider);

registerInstrumentations({
  tracerProvider: provider,
  instrumentations: [
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (req) =>
        UNTRACED_PATHS.has((req.url ?? '').split('?')[0]),
    }),
    new ExpressInstrumentation(),
    new NestInstrumentation(),
    // Pool warm-up queries outside a request would become root spans.
    new PgInstrumentation({ requireParentSpan: true }),
  ],
});

let stopping = false;
async function shutdown(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  // BatchSpanProcessor holds spans in memory; without this a stopped pod
  // loses the last batch — usually the one with the failure in it.
  await provider.shutdown().catch(() => undefined);
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
