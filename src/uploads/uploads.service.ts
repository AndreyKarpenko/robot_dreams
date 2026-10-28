import { randomUUID } from 'node:crypto';
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { normalizeIdempotencyKey } from '../outbox/idempotency';
import { Env } from '../config/env.schema';
import { PG_POOL } from '../db/database.module';
import {
  abortIfAny,
  deleteObject,
  ensureBucket,
  readObjectPrefix,
} from '../storage/bucket';
import { createStorageClient, type StorageConfig } from '../storage/client';
import { extensionFor, magicMatches } from '../storage/content-types';
import {
  errorName,
  isMissingObject,
  isNoSuchUpload,
  isUniqueViolation,
} from '../storage/errors';
import { isMultipart, partCountFor, partSizeFor } from '../storage/limits';

const SELECT = `id, key, owner_id, status, size, upload_id, content_type`;

type FileRow = {
  id: string;
  key: string;
  owner_id: string;
  status: 'PENDING' | 'COMPLETED';
  size: string;
  upload_id: string | null;
  content_type: string;
};

export type IntentView = {
  id: string;
  key: string;
  expiresIn: number;
  uploadId: string | null;
  partSize: number | null;
  url?: string;
  parts?: { partNumber: number; url: string }[];
};

export type ResumeView = {
  partSize: number;
  present: number[];
  missing: { partNumber: number; url: string }[];
};

export type CommitView = {
  id: string;
  key: string;
  size: number;
  etag: string;
};

const PART_ERRORS = new Set([
  'EntityTooSmall',
  'InvalidPart',
  'InvalidPartOrder',
]);

function storageFromConfig(
  config: ConfigService<Env, true>,
): StorageConfig | null {
  const accessKeyId = config.get('STORAGE_ACCESS_KEY', { infer: true });
  const secretAccessKey = config.get('STORAGE_SECRET_KEY', { infer: true });
  const bucket = config.get('STORAGE_BUCKET', { infer: true });
  if (!accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }
  const endpoint = config.get('STORAGE_ENDPOINT', { infer: true });
  return {
    endpoint: endpoint?.replace(/\/$/, '') || undefined,
    region: config.get('STORAGE_REGION', { infer: true }),
    accessKeyId,
    secretAccessKey,
    bucket,
    expiresIn: config.get('PRESIGN_EXPIRES_SEC', { infer: true }),
  };
}

function asRow(row: FileRow): FileRow {
  return {
    ...row,
    id: String(row.id),
    owner_id: String(row.owner_id),
    size: String(row.size),
  };
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly storage: StorageConfig | null;
  private readonly client: S3Client | null;
  private ready: Promise<void> | null = null;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {
    this.storage = storageFromConfig(config);
    this.client = this.storage ? createStorageClient(this.storage) : null;
  }

  onModuleDestroy(): void {
    this.client?.destroy();
  }

  async intent(
    userId: string,
    input: {
      contentType: string;
      size: number;
      idempotencyKey?: string;
    },
  ): Promise<IntentView> {
    const { client, storage } = this.requireReady();
    this.requireUserId(userId);
    await this.bucketReady(client, storage.bucket);
    const idem = this.idempotency(input.idempotencyKey);
    if (idem) {
      const existing = await this.findByIdempotency(userId, idem);
      if (existing) {
        return this.sign(existing);
      }
    }

    const ext = extensionFor(input.contentType);
    const key = `uploads/${userId}/${randomUUID()}.${ext}`;
    const multipart = isMultipart(input.size);
    let uploadId: string | null = null;
    if (multipart) {
      const created = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: storage.bucket,
          Key: key,
          ContentType: input.contentType,
        }),
      );
      uploadId = created.UploadId ?? null;
      if (!uploadId) {
        throw new Error('CreateMultipartUpload returned no upload id');
      }
    }

    try {
      const inserted = await this.pool.query<FileRow>(
        `INSERT INTO files (key, owner_id, status, size, upload_id, content_type, idempotency_key)
         VALUES ($1, $2, 'PENDING', $3, $4, $5, $6)
         RETURNING ${SELECT}`,
        [key, userId, input.size, uploadId, input.contentType, idem],
      );
      const row = asRow(inserted.rows[0]);
      this.logger.log(
        `intent fileId=${row.id} key=${row.key} multipart=${multipart ? 1 : 0}`,
      );
      return this.sign(row);
    } catch (err) {
      await abortIfAny(client, storage.bucket, key, uploadId);
      if (idem && isUniqueViolation(err)) {
        const existing = await this.findByIdempotency(userId, idem);
        if (existing) {
          return this.sign(existing);
        }
      }
      throw err;
    }
  }

  async resume(userId: string, fileId: string): Promise<ResumeView> {
    const { client, storage } = this.requireReady();
    await this.bucketReady(client, storage.bucket);
    const row = await this.owned(userId, fileId);
    if (!row.upload_id) {
      throw new ConflictException('not a multipart upload');
    }
    if (row.status === 'COMPLETED') {
      throw new ConflictException('upload is already completed');
    }
    const size = this.sizeOf(row);
    const partSize = partSizeFor(size);
    const expected = partCountFor(size);
    const listed = await this.listParts(
      client,
      storage.bucket,
      row.key,
      row.upload_id,
    );
    const present = listed.map((part) => part.PartNumber);
    const have = new Set(present);
    const missing: { partNumber: number; url: string }[] = [];
    for (let n = 1; n <= expected; n += 1) {
      if (have.has(n)) {
        continue;
      }
      const url = await getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: storage.bucket,
          Key: row.key,
          UploadId: row.upload_id,
          PartNumber: n,
        }),
        { expiresIn: storage.expiresIn },
      );
      missing.push({ partNumber: n, url });
    }
    this.logger.log(
      `resume fileId=${row.id} key=${row.key} present=${present.length} missing=${missing.length}`,
    );
    return { partSize, present, missing };
  }

  async commit(userId: string, fileId: string): Promise<CommitView> {
    const { client, storage } = this.requireReady();
    await this.bucketReady(client, storage.bucket);
    const row = await this.owned(userId, fileId);
    if (row.status !== 'COMPLETED' && row.upload_id) {
      await this.completeMultipart(client, storage.bucket, row);
    }
    const stat = await this.stat(client, storage.bucket, row.key);
    const expected = this.sizeOf(row);
    if (stat.size !== expected) {
      await deleteObject(client, storage.bucket, row.key);
      throw new ConflictException('uploaded size does not match the intent');
    }
    const prefix = await readObjectPrefix(client, storage.bucket, row.key);
    if (!magicMatches(row.content_type, prefix)) {
      await deleteObject(client, storage.bucket, row.key);
      throw new UnprocessableEntityException(
        'content does not match contentType',
      );
    }
    await this.pool.query(
      `UPDATE files SET status = 'COMPLETED', size = $2
        WHERE id = $1 AND owner_id = $3 AND status = 'PENDING'`,
      [row.id, stat.size, userId],
    );
    this.logger.log(`commit fileId=${row.id} key=${row.key} size=${stat.size}`);
    return { id: row.id, key: row.key, size: stat.size, etag: stat.etag };
  }

  private async completeMultipart(
    client: S3Client,
    bucket: string,
    row: FileRow,
  ): Promise<void> {
    const uploadId = row.upload_id;
    if (!uploadId) {
      return;
    }
    const size = this.sizeOf(row);
    const expected = partCountFor(size);
    const parts = await this.listParts(client, bucket, row.key, uploadId);
    if (
      parts.length !== expected ||
      parts.some((part, index) => part.PartNumber !== index + 1)
    ) {
      throw new ConflictException('multipart upload is incomplete');
    }
    try {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: row.key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              ETag: part.ETag,
              PartNumber: part.PartNumber,
            })),
          },
        }),
      );
    } catch (err) {
      if (isNoSuchUpload(err)) {
        return;
      }
      if (PART_ERRORS.has(errorName(err))) {
        throw new ConflictException('multipart upload cannot be completed');
      }
      throw err;
    }
  }

  private async listParts(
    client: S3Client,
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<{ ETag: string; PartNumber: number }[]> {
    const parts: { ETag: string; PartNumber: number }[] = [];
    let marker: string | undefined;
    for (;;) {
      const page = await client.send(
        new ListPartsCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const part of page.Parts ?? []) {
        if (part.PartNumber == null || !part.ETag) {
          continue;
        }
        parts.push({ ETag: part.ETag, PartNumber: part.PartNumber });
      }
      if (!page.IsTruncated || !page.NextPartNumberMarker) {
        break;
      }
      marker = page.NextPartNumberMarker;
    }
    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    return parts;
  }

  private async sign(row: FileRow): Promise<IntentView> {
    const { client, storage } = this.requireReady();
    const size = this.sizeOf(row);
    const base = {
      id: row.id,
      key: row.key,
      expiresIn: storage.expiresIn,
      uploadId: row.upload_id,
      partSize: row.upload_id ? partSizeFor(size) : null,
    };
    if (row.status === 'COMPLETED') {
      return base;
    }
    if (row.upload_id) {
      const count = partCountFor(size);
      const parts: { partNumber: number; url: string }[] = [];
      for (let n = 1; n <= count; n += 1) {
        const url = await getSignedUrl(
          client,
          new UploadPartCommand({
            Bucket: storage.bucket,
            Key: row.key,
            UploadId: row.upload_id,
            PartNumber: n,
          }),
          { expiresIn: storage.expiresIn },
        );
        parts.push({ partNumber: n, url });
      }
      return { ...base, parts };
    }
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: storage.bucket, Key: row.key }),
      { expiresIn: storage.expiresIn },
    );
    return { ...base, url };
  }

  private async stat(
    client: S3Client,
    bucket: string,
    key: string,
  ): Promise<{ size: number; etag: string }> {
    try {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return {
        size: head.ContentLength ?? -1,
        etag: (head.ETag ?? '').replaceAll('"', ''),
      };
    } catch (err) {
      if (isMissingObject(err)) {
        throw new ConflictException('upload has no object yet');
      }
      throw err;
    }
  }

  private async owned(userId: string, fileId: string): Promise<FileRow> {
    this.requireUserId(userId);
    if (!/^\d+$/.test(fileId)) {
      throw new NotFoundException();
    }
    const result = await this.pool.query<FileRow>(
      `SELECT ${SELECT} FROM files WHERE id = $1 AND owner_id = $2`,
      [fileId, userId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException();
    }
    return asRow(row);
  }

  private async findByIdempotency(
    userId: string,
    key: string,
  ): Promise<FileRow | null> {
    const result = await this.pool.query<FileRow>(
      `SELECT ${SELECT} FROM files WHERE owner_id = $1 AND idempotency_key = $2`,
      [userId, key],
    );
    const row = result.rows[0];
    return row ? asRow(row) : null;
  }

  private sizeOf(row: FileRow): number {
    const size = Number(row.size);
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new ConflictException('stored size is invalid');
    }
    return size;
  }

  private idempotency(value: string | undefined): string | null {
    const key = normalizeIdempotencyKey(value);
    if (!key) {
      return null;
    }
    if (key.length > 200) {
      throw new BadRequestException('Idempotency-Key is too long');
    }
    return key;
  }

  private requireUserId(userId: string): void {
    if (!/^\d+$/.test(userId)) {
      throw new NotFoundException();
    }
  }

  private requireReady(): { client: S3Client; storage: StorageConfig } {
    if (!this.client || !this.storage) {
      throw new ServiceUnavailableException('object storage is not configured');
    }
    return { client: this.client, storage: this.storage };
  }

  private bucketReady(client: S3Client, bucket: string): Promise<void> {
    this.ready ??= ensureBucket(client, bucket).catch((err: unknown) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }
}
