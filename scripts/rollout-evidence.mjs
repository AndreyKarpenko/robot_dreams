import { readFileSync, appendFileSync } from 'node:fs';
const text = readFileSync('evidence/rollout.txt', 'utf8');
const values = {};
for (const line of text.split('\n')) {
  const m = /^(requests|ok|failed|rollout-seconds)=(\d+)$/.exec(line);
  if (m) values[m[1]] = Number(m[2]);
}
for (const key of ['requests', 'ok', 'failed', 'rollout-seconds'])
  if (!Number.isFinite(values[key])) throw new Error(`Missing ${key}`);
appendFileSync(
  'evidence/evidence.txt',
  `rollout-requests=${values.requests}\nrollout-ok=${values.ok}\nrollout-failed=${values.failed}\nrollout-seconds=${values['rollout-seconds']}\n`,
);
if (
  values.failed !== 0 ||
  values.requests < 2000 ||
  values.ok !== values.requests
)
  throw new Error('Rollout gate failed');
