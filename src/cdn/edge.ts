import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { isMissingObject } from '../storage/errors';

type Cached = {
  body: Buffer;
  contentType: string;
  cacheControl: string;
  expiresAt: number;
};

function maxAge(cacheControl: string): number | null {
  if (!/public/i.test(cacheControl)) {
    return null;
  }
  const match = /max-age=(\d+)/i.exec(cacheControl);
  if (!match) {
    return null;
  }
  const seconds = Number(match[1]);
  return seconds > 0 ? seconds : null;
}

/**
 * The cache, not the public, holds storage credentials. That is the local
 * shape of OAC: anonymous clients talk to this process, and this process
 * reads the private bucket. Cache-Control is taken from the object.
 */
export function startEdge(options: {
  port: number;
  client: S3Client;
  bucket: string;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const cache = new Map<string, Cached>();
  const server = createServer((req, res) => {
    void handle(req, res, options, cache).catch(() => {
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end();
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${options.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: { client: S3Client; bucket: string },
  cache: Map<string, Cached>,
): Promise<void> {
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const key = decodeURIComponent(path.replace(/^\/+/, ''));
  if (!key || key.split('/').includes('..')) {
    res.writeHead(400);
    res.end();
    return;
  }
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    write(res, hit.body, hit.contentType, hit.cacheControl, 'HIT');
    return;
  }
  try {
    const obj = await options.client.send(
      new GetObjectCommand({ Bucket: options.bucket, Key: key }),
    );
    const body = Buffer.from(await obj.Body!.transformToByteArray());
    const cacheControl = obj.CacheControl ?? '';
    const contentType = obj.ContentType ?? 'application/octet-stream';
    const ttl = maxAge(cacheControl);
    if (ttl) {
      cache.set(key, {
        body,
        contentType,
        cacheControl,
        expiresAt: Date.now() + ttl * 1000,
      });
    }
    write(res, body, contentType, cacheControl, 'MISS');
  } catch (err) {
    res.writeHead(isMissingObject(err) ? 404 : 502);
    res.end();
  }
}

function write(
  res: ServerResponse,
  body: Buffer,
  contentType: string,
  cacheControl: string,
  cacheHeader: 'HIT' | 'MISS',
): void {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': cacheControl,
    'X-Cache': cacheHeader,
  });
  res.end(body);
}
