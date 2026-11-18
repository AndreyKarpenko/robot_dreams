import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { oidcGate } from './oidc-gate.mjs';
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'demo',
  alg: 'RS256',
  use: 'sig',
};
let issuer;
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify(
      req.url === '/jwks'
        ? { keys: [jwk] }
        : { issuer, jwks_uri: `${issuer}/jwks` },
    ),
  );
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
issuer = `http://127.0.0.1:${server.address().port}`;
const policy = {
  iss: issuer,
  aud: 'robot-dreams-deploy',
  subjects: ['repo:AndreyKarpenko/robot_dreams:environment:ci-kind'],
};
function token(sub) {
  const now = Math.floor(Date.now() / 1000);
  const data = [
    { alg: 'RS256', kid: 'demo' },
    { iss: issuer, aud: policy.aud, sub, iat: now, exp: now + 120 },
  ]
    .map((x) => Buffer.from(JSON.stringify(x)).toString('base64url'))
    .join('.');
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}
try {
  const green = token(policy.subjects[0]);
  const parts = green.split('.');
  const signature = Buffer.from(parts[2], 'base64url');
  signature[0] ^= 1;
  const cases = [
    ['green', green, 1, 1],
    ['foreign-sub', token('repo:foreign/attacker:environment:ci-kind'), 1, 0],
    [
      'bad-signature',
      `${parts[0]}.${parts[1]}.${signature.toString('base64url')}`,
      0,
      0,
    ],
  ];
  for (const [name, jwt, sig, allow] of cases) {
    const r = await oidcGate(
      jwt,
      policy,
      `${issuer}/.well-known/openid-configuration`,
    );
    console.log(
      `case=${name}\nsig-verified=${Number(r.signatureVerified)}\npolicy-allow=${Number(r.allow)}`,
    );
    if (Number(r.signatureVerified) !== sig || Number(r.allow) !== allow)
      process.exitCode = 1;
  }
} finally {
  server.close();
}
