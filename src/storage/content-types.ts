export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/gzip',
  'application/octet-stream',
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const EXTENSION: Record<AllowedContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/gzip': 'gz',
  'application/octet-stream': 'bin',
};

export function isAllowedContentType(
  value: string,
): value is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Extension comes from the allowlist, never from the client filename. */
export function extensionFor(contentType: string): string {
  if (!isAllowedContentType(contentType)) {
    throw new Error(`contentType is not allowed: ${contentType}`);
  }
  return EXTENSION[contentType];
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function magicOk(contentType: AllowedContentType, prefix: Buffer): boolean {
  switch (contentType) {
    case 'image/png':
      return (
        prefix.length >= PNG.length &&
        prefix.subarray(0, PNG.length).equals(PNG)
      );
    case 'image/jpeg':
      return (
        prefix.length >= 3 &&
        prefix[0] === 0xff &&
        prefix[1] === 0xd8 &&
        prefix[2] === 0xff
      );
    case 'image/gif':
      return (
        prefix.length >= 6 &&
        (prefix.subarray(0, 6).toString('ascii') === 'GIF87a' ||
          prefix.subarray(0, 6).toString('ascii') === 'GIF89a')
      );
    case 'image/webp':
      return (
        prefix.length >= 12 &&
        prefix.subarray(0, 4).toString('ascii') === 'RIFF' &&
        prefix.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case 'application/gzip':
      return prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b;
    case 'application/octet-stream':
      return true;
    default:
      return false;
  }
}

/** Types without a signature (dumps) skip the check. Images must match. */
export function magicMatches(contentType: string, prefix: Buffer): boolean {
  if (!isAllowedContentType(contentType)) {
    return false;
  }
  return magicOk(contentType, prefix);
}

export function demoPng(size = 32): Buffer {
  const buf = Buffer.alloc(size);
  PNG.copy(buf);
  return buf;
}
