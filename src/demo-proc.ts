import { spawn, type ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';

const children = new Set<ChildProcess>();

process.on('exit', () => {
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
    }
  }
});

export function bareEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    LANG: process.env.LANG ?? 'C',
  };
}

export function asBody(body: Buffer): ArrayBuffer {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy.buffer;
}

export function redact(text: string): string {
  return text.replace(/https?:\/\/\S+/g, '[url]').slice(0, 500);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket: Socket = connect({ host, port });
    const done = (open: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(false));
  });
}

export async function waitPortClosed(port: number): Promise<number> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const open = await portOpen(port);
    if (!open) {
      return 0;
    }
    if (Date.now() >= deadline) {
      return 1;
    }
    await sleep(100);
  }
}

export function spawnNode(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  input?: Buffer,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [script, ...args], {
    env,
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  if (input && child.stdin) {
    child.stdin.end(input);
  }
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      stderr += err.message;
      resolve({ code: 1, stdout, stderr });
    });
    child.on('exit', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
