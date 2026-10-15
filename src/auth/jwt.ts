import { createSign, createVerify, type KeyObject } from 'node:crypto';
import { isUserRole, type UserRole } from './roles';

export const ACCESS_TTL_SEC = 10 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
export const JWT_ISSUER = 'marketplace-api';
export const JWT_AUDIENCE = 'marketplace';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AccessClaims = {
  userId: string;
  role: UserRole;
  jti: string;
  familyId: string;
  exp: number;
};

export class TokenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TokenError';
  }
}

export function signAccessToken(
  claims: Omit<AccessClaims, 'exp'>,
  kid: string,
  privateKey: KeyObject,
  nowSec = Math.floor(Date.now() / 1000),
): { token: string; exp: number } {
  const exp = nowSec + ACCESS_TTL_SEC;
  const header = base64url(
    JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }),
  );
  const payload = base64url(
    JSON.stringify({
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      sub: claims.userId,
      role: claims.role,
      jti: claims.jti,
      family_id: claims.familyId,
      iat: nowSec,
      exp,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign('SHA256')
    .update(signingInput)
    .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
  return { token: `${signingInput}.${signature.toString('base64url')}`, exp };
}

/**
 * RFC 8725 §3.1: the verifier names the algorithms it accepts. A token whose
 * header says HS256 or none never reaches the signature check.
 */
export function verifyAccessToken(
  token: string,
  publicKeys: Map<string, KeyObject>,
  nowSec = Math.floor(Date.now() / 1000),
): AccessClaims {
  const options = {
    algorithms: ['ES256'] as const,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  };
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new TokenError('malformed');
  }

  const header = decodeJson(parts[0]);
  const alg =
    header && typeof header === 'object'
      ? (header as { alg?: unknown }).alg
      : undefined;
  const kid =
    header && typeof header === 'object'
      ? (header as { kid?: unknown }).kid
      : undefined;
  if (
    typeof alg !== 'string' ||
    !options.algorithms.includes(alg as 'ES256')
  ) {
    throw new TokenError('algorithm');
  }
  if (typeof kid !== 'string') {
    throw new TokenError('kid');
  }
  const publicKey = publicKeys.get(kid);
  if (!publicKey) {
    throw new TokenError('kid');
  }

  const signature = Buffer.from(parts[2], 'base64url');
  const valid = createVerify('SHA256')
    .update(`${parts[0]}.${parts[1]}`)
    .verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  if (!valid) {
    throw new TokenError('signature');
  }

  return readClaims(decodeJson(parts[1]), options, nowSec);
}

function readClaims(
  payload: unknown,
  options: { issuer: string; audience: string },
  nowSec: number,
): AccessClaims {
  if (payload == null || typeof payload !== 'object') {
    throw new TokenError('malformed');
  }
  const body = payload as Record<string, unknown>;
  if (body.iss !== options.issuer || body.aud !== options.audience) {
    throw new TokenError('audience');
  }
  if (typeof body.exp !== 'number' || body.exp <= nowSec) {
    throw new TokenError('expired');
  }
  if (typeof body.sub !== 'string' || body.sub.trim() === '') {
    throw new TokenError('subject');
  }
  if (!isUserRole(body.role)) {
    throw new TokenError('role');
  }
  if (typeof body.jti !== 'string' || !UUID.test(body.jti)) {
    throw new TokenError('jti');
  }
  if (typeof body.family_id !== 'string' || !UUID.test(body.family_id)) {
    throw new TokenError('family');
  }
  return {
    userId: body.sub,
    role: body.role,
    jti: body.jti,
    familyId: body.family_id,
    exp: body.exp,
  };
}

function decodeJson(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new TokenError('malformed');
  }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
