import { createHash } from 'node:crypto';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Public name carries a content hash, so a new body is a new URL. */
export async function publishHashedAsset(
  client: S3Client,
  bucket: string,
  body: Buffer,
): Promise<{ key: string }> {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8);
  const key = `assets/app.${hash}.css`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'text/css; charset=utf-8',
      CacheControl: ASSET_CACHE_CONTROL,
    }),
  );
  return { key };
}
