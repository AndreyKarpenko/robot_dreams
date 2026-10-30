import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { PRESIGN_TTL_SEC } from './limits';

export type StorageConfig = {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  expiresIn: number;
};

export function storageConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StorageConfig | null {
  const accessKeyId = env.STORAGE_ACCESS_KEY?.trim();
  const secretAccessKey = env.STORAGE_SECRET_KEY?.trim();
  const bucket = env.STORAGE_BUCKET?.trim();
  if (!accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }
  const endpoint = env.STORAGE_ENDPOINT?.trim().replace(/\/$/, '');
  const expiresRaw = env.PRESIGN_EXPIRES_SEC?.trim();
  const expiresIn = expiresRaw ? Number(expiresRaw) : PRESIGN_TTL_SEC;
  if (!Number.isInteger(expiresIn) || expiresIn < 1) {
    throw new Error('PRESIGN_EXPIRES_SEC must be a positive integer');
  }
  return {
    endpoint: endpoint || undefined,
    region: env.STORAGE_REGION?.trim() || 'us-east-1',
    accessKeyId,
    secretAccessKey,
    bucket,
    expiresIn,
  };
}

export function requireStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): StorageConfig {
  const config = storageConfigFromEnv(env);
  if (!config) {
    throw new Error(
      'STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY and STORAGE_BUCKET are required',
    );
  }
  return config;
}

export function createStorageClient(config: StorageConfig): S3Client {
  // Late-2024 SDK builds a CRC32 of uploads by default. A presigned URL is
  // signed before the body exists, so the query would carry the empty-body
  // checksum. WHEN_REQUIRED leaves the signature without that placeholder.
  const options: S3ClientConfig = {
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
  return new S3Client(options);
}
