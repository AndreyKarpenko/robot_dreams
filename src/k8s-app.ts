/**
 * Production entrypoint for the zero-downtime K8s demo (hw-28).
 *
 * Warmup before listen() mimics migrations / DB pool init so a broken
 * rollout strategy actually produces failed requests. On SIGTERM we flip
 * /readyz first, hold the socket open for DRAIN_MS, then close.
 */
import * as http from 'node:http';

const PORT = Number(process.env.PORT ?? 3000);
const WARMUP_MS = Number(process.env.WARMUP_MS ?? 4000);
const DRAIN_MS = Number(process.env.DRAIN_MS ?? 5000);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

// Runtime secret from the vault (#11) → K8s Secret → secretKeyRef.
requireEnv('APP_DB_PASSWORD');

let ready = false;
let draining = false;
let server: http.Server | undefined;

function send(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

async function listen(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, WARMUP_MS));

  server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];

    if (path === '/healthz') {
      // Alive as long as the process is up — never tied to readiness.
      send(res, 200, 'ok');
      return;
    }

    if (path === '/readyz') {
      // Only the readiness probe goes red on drain. In-flight / lagging
      // NodePort traffic must still get 200 until the socket closes —
      // otherwise endpoint-update lag shows up as failed≠0 under load.
      if (ready && !draining) {
        send(res, 200, 'ready');
      } else {
        send(res, 503, 'not-ready');
      }
      return;
    }

    // Before listen() completes we are not serving yet.
    if (!ready) {
      send(res, 503, 'not-ready');
      return;
    }

    send(res, 200, 'ok');
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(PORT, () => resolve());
  });

  ready = true;
  console.log(`k8s-app listening on ${PORT} (warmup=${WARMUP_MS}ms drain=${DRAIN_MS}ms)`);
}

async function shutdown(signal: string): Promise<void> {
  if (draining) {
    return;
  }
  // Flip readiness only — keep serving / until the drain window ends.
  // Setting ready=false here would 503 every lagging NodePort request.
  draining = true;
  console.log(`${signal}: readiness off, draining ${DRAIN_MS}ms`);

  await new Promise<void>((resolve) => setTimeout(resolve, DRAIN_MS));

  const current = server;
  if (!current) {
    process.exit(0);
  }

  await new Promise<void>((resolve) => {
    current.close(() => resolve());
    const timer = setTimeout(resolve, 2000);
    timer.unref();
  });
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

listen().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
