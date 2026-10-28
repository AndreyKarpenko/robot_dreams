/** Multipart ETag is not the MD5 of the file. The suffix is the part count. */
export function isMultipartEtag(
  etag: string,
  partCount: number,
  fileMd5Hex: string,
): boolean {
  const match = /^([0-9a-f]+)-(\d+)$/i.exec(etag);
  if (!match) {
    return false;
  }
  if (Number(match[2]) !== partCount) {
    return false;
  }
  return match[1].toLowerCase() !== fileMd5Hex.toLowerCase();
}
