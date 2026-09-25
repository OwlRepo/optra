import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common'
import type { Response } from 'express'
import { MulterError } from 'multer'

/**
 * Turns upload failures into the bodies the upload forms show. One filter for
 * every upload route - procurement, knowledge-base documents, datasets and
 * catalogs - where there used to be four copies of it.
 *
 * All four copies caught MulterError for an oversized file, and none of them
 * ever fired: FileInterceptor converts LIMIT_FILE_SIZE into a
 * PayloadTooLargeException before a filter sees it (transformException in
 * @nestjs/platform-express multer.utils). So every route answered with the
 * framework's "File too large" instead of naming the limit. Both shapes are
 * handled here, and the real one is pinned by API e2e on every upload route.
 */
@Catch(MulterError, BadRequestException, PayloadTooLargeException)
export class UploadExceptionFilter implements ExceptionFilter {
  // Read per instance, from the same variable each controller sizes multer
  // with, so the message can never name a different limit than the one hit.
  private readonly maxUploadMb = Number(process.env.MAX_UPLOAD_MB ?? 25)

  catch(exception: MulterError | BadRequestException | PayloadTooLargeException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()

    if (
      exception instanceof PayloadTooLargeException ||
      (exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE')
    ) {
      response.status(413).json({ statusCode: 413, message: `File exceeds ${this.maxUploadMb}MB upload limit` })
      return
    }

    if (exception instanceof BadRequestException) {
      // ValidationPipe throws a body whose `message` is an ARRAY of per-field
      // errors; flattening that loses every field-level message the upload form
      // needs. Testing for an array specifically, not just for an object: Nest
      // also wraps a plain-string BadRequestException (what a fileFilter
      // raises) into an object, and passing that through would silently add an
      // `error` key to a response shape clients already depend on.
      const body = exception.getResponse()
      if (typeof body === 'object' && body !== null && Array.isArray((body as { message?: unknown }).message)) {
        response.status(400).json(body)
        return
      }

      response.status(400).json({ statusCode: 400, message: exception.message })
      return
    }

    throw exception
  }
}
