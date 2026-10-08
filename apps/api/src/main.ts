import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { configureApp } from './bootstrap'

async function bootstrap() {
  // rawBody keeps the exact bytes of every JSON body on req.rawBody. The Lemon
  // Squeezy webhook is verified over those bytes, never over re-serialized JSON.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true })
  configureApp(app)
  // PORT lets the browser e2e suite run a second API beside a dev one; the
  // Dockerfile healthcheck already reads ${PORT:-3001}.
  const port = Number(process.env.PORT ?? 3001)
  await app.listen(port)
  console.log(`API running on http://localhost:${port}`)
}
bootstrap()
