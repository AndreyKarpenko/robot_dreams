/**
 * Puts bytes to a URL and prints the HTTP status. The parent starts this
 * with an environment that has no storage credentials: the presigned URL is
 * the only authority.
 */
async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    throw new Error('missing url');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const res = await fetch(url, {
    method: 'PUT',
    body: Buffer.concat(chunks),
    redirect: 'manual',
  });
  await res.arrayBuffer();
  process.stdout.write(String(res.status));
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message.split('?')[0]);
  process.exit(1);
});
