"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Production entrypoint for the zero-downtime K8s demo (hw-28).
 *
 * Warmup before listen() mimics migrations / DB pool init so a broken
 * rollout strategy actually produces failed requests. On SIGTERM we flip
 * /readyz first, hold the socket open for DRAIN_MS, then close.
 */
const http = __importStar(require("node:http"));
const PORT = Number(process.env.PORT ?? 3000);
const WARMUP_MS = Number(process.env.WARMUP_MS ?? 4000);
const DRAIN_MS = Number(process.env.DRAIN_MS ?? 8000);
function requireEnv(name) {
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
let server;
function send(res, status, body) {
    const headers = {
        'content-type': 'text/plain; charset=utf-8',
    };
    // Only while draining: ask clients to drop keep-alive so close() does not
    // RST reused sockets (curl 000). Always-on Connection:close exhausts
    // ephemeral ports under the loadgen.
    if (draining) {
        headers.connection = 'close';
    }
    res.writeHead(status, headers);
    res.end(body);
}
async function listen() {
    await new Promise((resolve) => setTimeout(resolve, WARMUP_MS));
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
            }
            else {
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
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(PORT, () => resolve());
    });
    ready = true;
    console.log(`k8s-app listening on ${PORT} (warmup=${WARMUP_MS}ms drain=${DRAIN_MS}ms)`);
}
async function shutdown(signal) {
    if (draining) {
        return;
    }
    // Flip readiness only — keep serving / until the drain window ends.
    // Setting ready=false here would 503 every lagging NodePort request.
    draining = true;
    console.log(`${signal}: readiness off, draining ${DRAIN_MS}ms`);
    // Do NOT closeIdleConnections() here: under keep-alive load that RSTs the
    // next request on an idle socket (curl 000). Connection: close on responses
    // lets clients retire sockets cleanly during the drain window; we only sweep
    // leftovers immediately before close().
    await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));
    const current = server;
    if (!current) {
        process.exit(0);
    }
    current.closeIdleConnections();
    await new Promise((resolve) => {
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
listen().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
