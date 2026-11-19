import { readFileSync, appendFileSync } from 'node:fs';
const raw = readFileSync('evidence/deployment.json', 'utf8');
const deployment = JSON.parse(raw);
const image = deployment.spec.template.spec.containers[0].image;
const digest = image.split('@')[1];
if (
  !/^sha256:[a-f0-9]{64}$/.test(digest) ||
  digest !== process.env.BUILT_DIGEST
)
  throw new Error('Digest mismatch');
const secret = process.env.APP_DB_PASSWORD;
if (!secret) throw new Error('APP_DB_PASSWORD required');
const count = raw.split(secret).length - 1;
const builds = readFileSync('evidence/build.log', 'utf8')
  .trim()
  .split('\n').length;
appendFileSync(
  'evidence/evidence.txt',
  `deployed-digest=${digest}\nbuild-invocations=${builds}\nsecret-in-manifest=${count}\n` +
    readFileSync('evidence/scan.txt', 'utf8'),
);
if (count || builds !== 1) throw new Error('Evidence gate failed');
