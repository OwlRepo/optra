import { Logger, NotFoundException } from '@nestjs/common'

/**
 * The object a row points at is not in storage. Thrown by every StorageService
 * reader in place of the SDK's NoSuchKey / NotFound / 404, so callers can tell
 * "the file is gone" (a 404 for a download, a permanent failure for a parse)
 * from "storage is unreachable or misconfigured" (still a 500, still retried).
 *
 * The message is deliberately constant and says nothing about the key: callers
 * copy error messages into client-visible fields (procurement's `lastError`),
 * and storage keys never leave the API. The key is kept on `.key` for logs.
 */
export class StorageObjectNotFoundError extends Error {
  // Assigned by hand rather than through Error's options bag: apps/api targets
  // ES2021, whose lib does not type `cause`.
  readonly cause: unknown

  constructor(
    readonly key: string,
    cause?: unknown,
  ) {
    super('The stored file is missing. Upload it again.')
    this.name = 'StorageObjectNotFoundError'
    this.cause = cause
  }
}

/**
 * Awaits a storage read on behalf of a download route, turning "the object is
 * gone" into a 404 with a message the UI can show. The key goes to the log,
 * never to the client. Every other failure is rethrown unchanged, so an
 * outage still surfaces as a 500 rather than masquerading as a missing file.
 */
export async function readOrNotFound<T>(read: Promise<T>, message: string, logger: Logger): Promise<T> {
  try {
    return await read
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      logger.warn(`${message}: object ${error.key} is not in storage`)
      throw new NotFoundException(message)
    }
    throw error
  }
}
