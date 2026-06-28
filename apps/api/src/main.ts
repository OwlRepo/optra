import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.use(cookieParser())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
  app.enableCors({
    origin: process.env.WEB_URL || 'http://localhost:3000',
    credentials: true,
  })
  await app.listen(3001)
  console.log('API running on http://localhost:3001')
}
bootstrap()
