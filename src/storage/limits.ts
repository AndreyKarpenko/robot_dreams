/**
 * S3 allows at most 10 000 parts. Every part except the last must be at least
 * 5 MiB, otherwise CompleteMultipartUpload returns EntityTooSmall.
 * partSize = max(5 MiB, ceil(fileSize / 10 000)) — derived, not a fixed chunk.
 */
export const S3_MAX_PARTS = 10_000;
export const S3_MIN_PART_BYTES = 5 * 1024 * 1024;

/** Avatar form: the browser PUTs immediately. Presigned URLs cannot be revoked. */
export const PRESIGN_TTL_SEC = 120;
export const PRESIGN_TTL_CAP_SEC = 15 * 60;
export const MAX_OBJECT_BYTES = 64 * 1024 * 1024 * 1024;

/** Below this a single PUT is the whole upload: the file cannot be split. */
export function multipartThresholdBytes(): number {
  return S3_MIN_PART_BYTES;
}

export function partSizeFor(fileBytes: number): number {
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 1) {
    throw new Error('file size must be a positive safe integer');
  }
  const fromCap = Math.ceil(fileBytes / S3_MAX_PARTS);
  return Math.max(S3_MIN_PART_BYTES, fromCap);
}

export function partCountFor(fileBytes: number): number {
  return Math.ceil(fileBytes / partSizeFor(fileBytes));
}

export function isMultipart(fileBytes: number): boolean {
  return fileBytes > multipartThresholdBytes();
}

/** Two full parts plus a short last part — exactly three, the demo's shape. */
export function multipartDemoFile(): Buffer {
  const size = S3_MIN_PART_BYTES * 2 + 64 * 1024;
  const buf = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i += 1) {
    buf[i] = i % 251;
  }
  return buf;
}
