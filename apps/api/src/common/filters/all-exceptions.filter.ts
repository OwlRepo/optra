import { randomUUID } from 'crypto'
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'

/**
 * Global catch-all filter (PRODUCTION-READINESS gap A6).
 *
 * Nest's default behavior turns any non-HttpException into a bare
 * `{"statusCode":500,"message":"Internal server error"}` and throws the real
 * message away before it reaches the client — correct for leakage, but it
 * leaves a user-reported 500 with no thread back to the stack trace that only
 * exists in `docker compose logs api`.
 *
 * This filter keeps the generic client message and adds a `requestId` that is
 * also stamped on the server-side error log, so a screenshot of a failed
 * request is enough to grep the exact stack out of the container logs.
 *
 * HttpExceptions (400/401/403/404/503 raised deliberately by services and
 * guards) pass through untouched — they are expected control flow, not
 * crashes, and must not be logged at error level.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('UnhandledException')

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp()
    const response = http.getResponse()
    const request = http.getRequest()

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const body = exception.getResponse()
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body)
      return
    }

    const requestId = randomUUID().slice(0, 8)
    const method = request?.method ?? 'UNKNOWN'
    const url = request?.url ?? 'unknown'
    const detail = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)
    const cause = exception instanceof Error && exception.cause ? `\ncaused by: ${String(exception.cause)}` : ''

    this.logger.error(`[${requestId}] ${method} ${url} failed: ${detail}${cause}`)

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      requestId,
    })
  }
}
