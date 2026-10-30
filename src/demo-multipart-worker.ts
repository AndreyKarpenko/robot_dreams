import { readFileSync } from 'node:fs';
import { asBody, sleep } from './demo-proc';

type MissingPart = { partNumber: number; url: string };

function slice(file: Buffer, partSize: number, partNumber: number): Buffer {
  const start = (partNumber - 1) * partSize;
  const end = Math.min(start + partSize, file.length);
  if (start < 0 || start >= file.length) {
    throw new Error(`part ${partNumber} is outside the file`);
  }
  return Buffer.from(file.subarray(start, end));
}

async function putPart(url: string, body: Buffer): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    body: asBody(body),
    redirect: 'manual',
  });
  await res.arrayBuffer();
  if (res.status !== 200) {
    throw new Error(`part status ${res.status}`);
  }
}

async function seed(
  file: Buffer,
  partSize: number,
  urls: string[],
): Promise<void> {
  for (let i = 0; i < urls.length; i += 1) {
    await putPart(urls[i], slice(file, partSize, i + 1));
  }
}

async function resumeMissing(
  base: string,
  fileId: string,
  token: string,
): Promise<MissingPart[]> {
  const res = await fetch(`${base}/uploads/${fileId}/resume`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as { missing?: MissingPart[] };
  if (res.status !== 200 || !Array.isArray(body.missing)) {
    throw new Error(`resume ${res.status}`);
  }
  return body.missing;
}

async function resume(
  file: Buffer,
  partSize: number,
  base: string,
  fileId: string,
  token: string,
): Promise<number> {
  let missing = await resumeMissing(base, fileId, token);
  for (let attempt = 0; attempt < 5 && missing.length > 1; attempt += 1) {
    await sleep(200);
    missing = await resumeMissing(base, fileId, token);
  }
  for (const part of missing) {
    await putPart(part.url, slice(file, partSize, part.partNumber));
  }
  return missing.length;
}

async function main(): Promise<void> {
  const [mode, filePath, partSizeRaw, ...rest] = process.argv.slice(2);
  const partSize = Number(partSizeRaw);
  if (!mode || !filePath || !Number.isInteger(partSize) || partSize < 1) {
    throw new Error('usage: seed|resume <file> <partSize> ...');
  }
  const file = readFileSync(filePath);
  if (mode === 'seed') {
    await seed(file, partSize, rest);
    return;
  }
  if (mode === 'resume') {
    const [base, fileId, token] = rest;
    if (!base || !fileId || !token) {
      throw new Error('resume needs base, file id, and token');
    }
    const uploaded = await resume(file, partSize, base, fileId, token);
    process.stdout.write(String(uploaded));
    return;
  }
  throw new Error(`unknown mode ${mode}`);
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message.split('?')[0]);
  process.exit(1);
});
