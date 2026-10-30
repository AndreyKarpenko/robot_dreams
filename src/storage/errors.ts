export function errorName(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    typeof err.name === 'string'
  ) {
    return err.name;
  }
  return '';
}

export function httpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object' || !('$metadata' in err)) {
    return undefined;
  }
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  return typeof status === 'number' ? status : undefined;
}

export function isMissingObject(err: unknown): boolean {
  const name = errorName(err);
  return name === 'NotFound' || name === 'NoSuchKey' || httpStatus(err) === 404;
}

export function isNoSuchUpload(err: unknown): boolean {
  return errorName(err) === 'NoSuchUpload';
}

export function isBucketExists(err: unknown): boolean {
  const name = errorName(err);
  return (
    name === 'BucketAlreadyOwnedByYou' ||
    name === 'BucketAlreadyExists' ||
    httpStatus(err) === 409
  );
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
