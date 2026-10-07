import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common'
import type { Response } from 'express'
import { MulterError } from 'multer'
import { maxUploadMb } from './upload-limit'

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
  // Read per instance, through the same function each controller sizes
  // multer with (upload-limit.ts).
  private readonly maxUploadMb = maxUploadMb()

  catch(exception: MulterError | BadRequestException | PayloadTooLargeException, host: ArgumentsHost): void {
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

// What multer says for LIMIT_UNEXPECTED_FILE; @nestjs/platform-express forwards it verbatim.
const UNEXPECTED_FILE_MESSAGE = 'Unexpected field'

/**
 * For the multi-file photo routes only. There, multer's "unexpected field" can
 * only mean a file beyond the interceptor's maximum, so it reads "Too many
 * files". On a single-file route the same text means a wrong field name, which
 * the base filter keeps answering as before.
 *
 * It arrives either as the raw MulterError or, through FilesInterceptor, as a
 * BadRequestException carrying multer's own text. Neither echoes the field name.
 */
@Catch(MulterError, BadRequestException, PayloadTooLargeException)
export class PhotoUploadExceptionFilter extends UploadExceptionFilter {
  catch(exception: MulterError | BadRequestException | PayloadTooLargeException, host: ArgumentsHost): void {
    if (
      (exception instanceof MulterError && exception.code === 'LIMIT_UNEXPECTED_FILE') ||
      (exception instanceof BadRequestException && exception.message === UNEXPECTED_FILE_MESSAGE)
    ) {
      host.switchToHttp().getResponse<Response>().status(400).json({ statusCode: 400, message: 'Too many files' })
      return
    }
    super.catch(exception, host)
  }
}
