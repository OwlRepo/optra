const DEFAULT_MAX_UPLOAD_MB = 25

/**
 * The upload size limit, in MB: MAX_UPLOAD_MB when it is a positive number,
 * otherwise 25. The one place it is read - every upload controller sizes
 * multer with it and UploadExceptionFilter names it in the 413 - so the
 * message can never name a different limit than the one enforced. An empty
 * value used to parse as a 0-byte limit.
 */
export function maxUploadMb(): number {
  const parsed = Number(process.env.MAX_UPLOAD_MB)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_MB
}

export function maxUploadBytes(): number {
  return maxUploadMb() * 1024 * 1024
}
