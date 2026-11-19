import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
const dir = 'src/gate-fixtures';
mkdirSync(`${dir}/orders`, { recursive: true });
mkdirSync(`${dir}/products`, { recursive: true });
let bad = false;
function run(name, command, env = {}) {
  const r = spawnSync('bash', ['-c', command], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  const code = r.status ?? 1;
  console.log(`${name}=${code}`);
  if (
    (name.endsWith('-ok') && code !== 0) ||
    (name.endsWith('-broken') && code === 0)
  ) {
    process.stderr.write((r.stdout ?? '') + (r.stderr ?? ''));
    bad = true;
  }
}
try {
  run('types-ok', 'npm run gate:types');
  writeFileSync(`${dir}/type.ts`, 'export const value: number = "broken";\n');
  run('types-broken', 'npm run gate:types');
  rmSync(`${dir}/type.ts`);
  const baseline = 'openapi/baseline.yaml';
  run('contract-ok', 'npm run gate:contract', {
    CONTRACT_BASE: baseline,
    CONTRACT_HEAD: baseline,
  });
  // Removing every endpoint breaks existing v1 clients.
  const spec = readFileSync(baseline, 'utf8');
  const { load, dump } = await import('js-yaml');
  const broken = load(spec);
  broken.paths = {};
  writeFileSync(`${dir}/broken.yaml`, dump(broken));
  run('contract-broken', 'npm run gate:contract', {
    CONTRACT_BASE: baseline,
    CONTRACT_HEAD: `${dir}/broken.yaml`,
  });
  run('architecture-ok', 'npm run gate:architecture');
  writeFileSync(`${dir}/products/private.ts`, 'export const internal = 1;\n');
  writeFileSync(
    `${dir}/orders/illegal.ts`,
    "import { internal } from '../products/private';\nexport const leaked = internal;\n",
  );
  run('architecture-broken', 'npm run gate:architecture');
  if (!process.env.SCAN_IMAGE) {
    const inspect = spawnSync(
      'docker',
      ['image', 'inspect', 'marketplace-api:hw28'],
      { stdio: 'ignore' },
    );
    if (inspect.status !== 0) {
      const build = spawnSync('npm', ['run', 'image:build'], {
        stdio: 'inherit',
      });
      if (build.status !== 0)
        throw new Error('Docker must be running to prepare the HW28 image');
    }
  }
  // Both executions invoke the original HW28 image scanner, including report counting.
  run('scan-ok', 'npm run scan', { SCAN_MAX: '99999' });
  run('scan-broken', 'npm run scan', { SCAN_MAX: '-1' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = bad ? 1 : 0;
