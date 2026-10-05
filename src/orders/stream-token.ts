import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type TokenPayload = {
  uid: string;
  exp: number;
};

export function assertStreamTokenSecret(): void {
  readSecret();
}

/** HMAC over `{uid, exp}`. The client cannot substitute another buyer id. */
export function signStreamToken(userId: string, now = Date.now()): string {
  const uid = userId.trim();
  if (uid === '') {
    throw new Error('stream token user id is empty');
  }
  const payload = encodePayload({ uid, exp: now + TTL_MS });
  return `${payload}.${sign(payload)}`;
}

export function verifyStreamToken(
  token: string,
  now = Date.now(),
): string | undefined {
  let secret: string;
  try {
    secret = readSecret();
  } catch {
    return undefined;
  }

  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) {
    return undefined;
  }
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload, secret);
  const got = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return undefined;
  }

  const parsed = decodePayload(payload);
  if (!parsed || parsed.exp <= now) {
    return undefined;
  }
  return parsed.uid;
}

function readSecret(): string {
  const secret = process.env.STREAM_TOKEN_SECRET?.trim();
  if (!secret) {
    throw new Error('STREAM_TOKEN_SECRET is not set');
  }
  return secret;
}

function sign(payload: string, secret = readSecret()): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodePayload(payload: TokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(payload: string): TokenPayload | undefined {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    if (parsed == null || typeof parsed !== 'object') {
      return undefined;
    }
    const uid = (parsed as { uid?: unknown }).uid;
    const exp = (parsed as { exp?: unknown }).exp;
    if (typeof uid !== 'string' || uid.trim() === '') {
      return undefined;
    }
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      return undefined;
    }
    return { uid, exp };
  } catch {
    return undefined;
  }
}
