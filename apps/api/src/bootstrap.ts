import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { trustProxySetting } from './common/trust-proxy'

/** Everything main.ts applies to the app, shared with the e2e suites that need production behaviour. */
export function configureApp(app: NestExpressApplication): void {
  app.use(cookieParser())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
  app.useGlobalFilters(new AllExceptionsFilter())
  app.enableCors({
    origin: process.env.WEB_URL || 'http://localhost:3000',
    credentials: true,
  })
  // req.ip - what the throttler keys on - becomes the visitor's address only
  // behind a trusted hop; see common/trust-proxy.ts.
  app.set('trust proxy', trustProxySetting())
}
