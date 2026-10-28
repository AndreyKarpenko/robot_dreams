import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  type S3Client,
} from '@aws-sdk/client-s3';
import { isBucketExists, isMissingObject, isNoSuchUpload } from './errors';

const prepared = new Set<string>();

async function createBucket(client: S3Client, bucket: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      return;
    } catch (err) {
      if (isBucketExists(err)) {
        return;
      }
      if (attempt === 7) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}

/** Private bucket. No public policy: anonymous GetObject stays 403. */
export async function ensureBucket(
  client: S3Client,
  bucket: string,
): Promise<void> {
  if (prepared.has(bucket)) {
    return;
  }
  await createBucket(client, bucket);
  prepared.add(bucket);
}

export async function resetBucket(
  client: S3Client,
  bucket: string,
): Promise<void> {
  await ensureBucket(client, bucket);

  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;
  for (;;) {
    const page = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      }),
    );
    for (const upload of page.Uploads ?? []) {
      if (!upload.Key || !upload.UploadId) {
        continue;
      }
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: upload.Key,
          UploadId: upload.UploadId,
        }),
      );
    }
    if (!page.IsTruncated) {
      break;
    }
    keyMarker = page.NextKeyMarker;
    uploadIdMarker = page.NextUploadIdMarker;
  }

  let token: string | undefined;
  for (;;) {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: token,
      }),
    );
    for (const item of page.Contents ?? []) {
      if (!item.Key) {
        continue;
      }
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: item.Key }),
      );
    }
    if (!page.IsTruncated || !page.NextContinuationToken) {
      break;
    }
    token = page.NextContinuationToken;
  }
}

export async function abortIfAny(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string | null,
): Promise<void> {
  if (!uploadId) {
    return;
  }
  try {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  } catch (err) {
    if (!isNoSuchUpload(err)) {
      throw err;
    }
  }
}

export async function deleteObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function readObjectPrefix(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const obj = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: 'bytes=0-15',
    }),
  );
  if (!obj.Body) {
    return Buffer.alloc(0);
  }
  return Buffer.from(await obj.Body.transformToByteArray());
}

export async function headObjectStatus(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<number> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return 200;
  } catch (err) {
    if (isMissingObject(err)) {
      return 404;
    }
    const status = (err as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (typeof status === 'number') {
      return status;
    }
    throw err;
  }
}

export async function headObjectMeta(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<{ size: number; etag: string }> {
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );
  return {
    size: head.ContentLength ?? -1,
    etag: (head.ETag ?? '').replaceAll('"', ''),
  };
}
