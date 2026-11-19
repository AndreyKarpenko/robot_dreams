import { createPublicKey, verify } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function oidcGate(token, policy, discoveryUrl) {
  let signatureVerified = false;
  let claims;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string')
      throw new Error('Unsupported key');
    const discoveryResponse = await fetch(discoveryUrl);
    if (!discoveryResponse.ok) throw new Error('Discovery failed');
    const discovery = await discoveryResponse.json();
    if (discovery.issuer !== policy.iss)
      throw new Error('Discovery issuer mismatch');
    const response = await fetch(discovery.jwks_uri);
    if (!response.ok) throw new Error('JWKS failed');
    const jwks = await response.json();
    const keys = jwks.keys.filter(
      (k) =>
        k.kid === header.kid &&
        k.kty === 'RSA' &&
        (!k.use || k.use === 'sig') &&
        (!k.alg || k.alg === 'RS256'),
    );
    if (keys.length !== 1) throw new Error('Ambiguous key');
    signatureVerified = verify(
      'RSA-SHA256',
      Buffer.from(parts.slice(0, 2).join('.')),
      createPublicKey({ key: keys[0], format: 'jwk' }),
      Buffer.from(parts[2], 'base64url'),
    );
    if (!signatureVerified) throw new Error('Signature rejected');
    claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
    const now = Math.floor(Date.now() / 1000);
    const allow =
      claims.iss === policy.iss &&
      claims.aud === policy.aud &&
      policy.subjects.includes(claims.sub) &&
      Number.isFinite(claims.exp) &&
      claims.exp > now &&
      Number.isFinite(claims.iat) &&
      claims.iat <= now + 30 &&
      (claims.nbf === undefined || claims.nbf <= now);
    return { signatureVerified, allow, claims };
  } catch {
    return { signatureVerified, allow: false };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const policy = JSON.parse(
    readFileSync(process.env.OIDC_POLICY ?? 'oidc/policy.json', 'utf8'),
  );
  let token;
  if (process.env.OIDC_TOKEN_FILE)
    token = readFileSync(process.env.OIDC_TOKEN_FILE, 'utf8').trim();
  else {
    const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
    url.searchParams.set('audience', policy.aud);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
      },
    });
    if (!response.ok) throw new Error('ID-token request failed');
    token = (await response.json()).value;
  }
  const result = await oidcGate(
    token,
    policy,
    process.env.OIDC_DISCOVERY_URL ??
      `${policy.iss}/.well-known/openid-configuration`,
  );
  console.log(
    `sig-verified=${Number(result.signatureVerified)}\npolicy-allow=${Number(result.allow)}`,
  );
  if (result.allow) {
    const lines = `creds-source=oidc\noidc-sig-verified=1\noidc-iss=${result.claims.iss}\noidc-aud=${result.claims.aud}\noidc-sub=${result.claims.sub}\n`;
    process.stdout.write(lines);
    if (process.env.EVIDENCE_FILE)
      appendFileSync(process.env.EVIDENCE_FILE, lines);
  }
  process.exitCode = result.allow ? 0 : 1;
}
