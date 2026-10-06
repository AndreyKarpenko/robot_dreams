export class InvariantError extends Error {}

export function report(lines: Array<[string, string | number]>): void {
  for (const [key, value] of lines) {
    console.log(`${key}=${value}`);
  }
}

export function invariant(ok: boolean, message: string): asserts ok {
  if (!ok) {
    console.error(`invariant failed: ${message}`);
    throw new InvariantError(message);
  }
}

export function failDemo(err: unknown): void {
  if (!(err instanceof InvariantError)) {
    console.error(err);
  }
  process.exitCode = 1;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
