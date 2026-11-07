#!/usr/bin/env node
/**
 * Lightweight concurrent load generator.
 * Writes one HTTP status code per line to OUT_FILE.
 * Connection failures → 000. Stop when CONTROL_FILE is removed.
 */
import http from 'node:http';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [urlArg, outFile, concurrencyArg, controlFile] = process.argv.slice(2);
if (!urlArg || !outFile || !controlFile) {
  console.error('usage: loadgen.mjs URL OUT_FILE CONCURRENCY CONTROL_FILE');
  process.exit(2);
}

const target = new URL(urlArg);
const concurrency = Number(concurrencyArg || 32);
fs.writeFileSync(outFile, '');
fs.writeFileSync(controlFile, '1');

const agent = new http.Agent({
  keepAlive: true,
  maxSockets: concurrency,
  keepAliveMsecs: 1000,
});

function oneRequest() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname || '/',
        method: 'GET',
        agent,
        timeout: 2000,
      },
      (res) => {
        res.resume();
        resolve(String(res.statusCode ?? '000'));
      },
    );
    req.on('error', () => resolve('000'));
    req.on('timeout', () => {
      req.destroy();
      resolve('000');
    });
    req.end();
  });
}

// Pace requests so Endpoints/iptables updates can win the race under kind NodePort.
// High RPS (tens of thousands/s) still produces a handful of 000s even with preStop.
const paceMs = Number(process.env.LOAD_PACE_MS || 4);

async function worker() {
  const stream = fs.createWriteStream(outFile, { flags: 'a' });
  while (fs.existsSync(controlFile)) {
    const code = await oneRequest();
    if (!stream.write(`${code}\n`)) {
      await new Promise((r) => stream.once('drain', r));
    }
    if (paceMs > 0) {
      await sleep(paceMs);
    }
  }
  await new Promise((r) => stream.end(r));
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
agent.destroy();
// Keep the event loop alive briefly so the parent can observe exit.
await sleep(10);
