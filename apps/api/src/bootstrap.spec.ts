import { Body, Controller, Post, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { IsEmail } from 'class-validator'
import type { Request, Response } from 'express'
import { configureApp } from './bootstrap'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'

class InviteBody {
  @IsEmail()
  email!: string
}

function fakeApp() {
  return {
    use: jest.fn(),
    useGlobalPipes: jest.fn(),
    useGlobalFilters: jest.fn(),
    enableCors: jest.fn(),
    set: jest.fn(),
    useBodyParser: jest.fn(),
  }
}

function configure(app: ReturnType<typeof fakeApp>) {
  configureApp(app as unknown as NestExpressApplication)
}

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: { blob?: string }) {
    return { length: body.blob?.length ?? 0 }
  }
}

describe('configureApp', () => {
  const original = { WEB_URL: process.env.WEB_URL, TRUST_PROXY: process.env.TRUST_PROXY }

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('error: refuses to boot when TRUST_PROXY would trust every hop', () => {
    process.env.TRUST_PROXY = 'true'
    expect(() => configure(fakeApp())).toThrow('TRUST_PROXY must be a positive hop count')
  })

  it('edge: raises the JSON body limit to 1mb so a 200-line review body fits', () => {
    delete process.env.TRUST_PROXY
    const app = fakeApp()
    configure(app)
    expect(app.useBodyParser).toHaveBeenCalledWith('json', { limit: '1mb' })
  })

  it('edge: a ~900kb JSON body is accepted (the Express default of 100kb would refuse it)', async () => {
    delete process.env.TRUST_PROXY
    const app = await Test.createTestingModule({ controllers: [EchoController] })
      .compile()
      .then((moduleRef) => moduleRef.createNestApplication<NestExpressApplication>())
    configureApp(app)
    await app.init()
    try {
      const res = await request(app.getHttpServer())
        .post('/echo')
        .send({ blob: 'x'.repeat(900_000) })
        .expect(201)
      expect(res.body).toEqual({ length: 900_000 })
    } finally {
      await app.close()
    }
  })

  it('edge: trusts no proxy hop when TRUST_PROXY is unset', () => {
    delete process.env.TRUST_PROXY
    const app = fakeApp()
    configure(app)
    expect(app.set).toHaveBeenCalledWith('trust proxy', false)
  })

  it('edge: allows credentialed CORS from the local web app when WEB_URL is unset', () => {
    delete process.env.WEB_URL
    delete process.env.TRUST_PROXY
    const app = fakeApp()
    configure(app)
    expect(app.enableCors).toHaveBeenCalledWith({ origin: 'http://localhost:3000', credentials: true })
  })

  it('edge: the global validation pipe strips body fields no DTO declares', async () => {
    delete process.env.TRUST_PROXY
    const app = fakeApp()
    configure(app)
    const [pipe] = app.useGlobalPipes.mock.calls[0] as [ValidationPipe]
    expect(pipe).toBeInstanceOf(ValidationPipe)
    await expect(
      pipe.transform({ email: 'buyer@example.com', role: 'owner' }, { type: 'body', metatype: InviteBody }),
    ).resolves.toEqual({ email: 'buyer@example.com' })
  })

  it('regression: a JSON body over the new 1mb limit is still refused (the limit was raised, not removed)', async () => {
    delete process.env.TRUST_PROXY
    const app = await Test.createTestingModule({ controllers: [EchoController] })
      .compile()
      .then((moduleRef) => moduleRef.createNestApplication<NestExpressApplication>())
    configureApp(app)
    await app.init()
    try {
      const res = await request(app.getHttpServer())
        .post('/echo')
        .send({ blob: 'x'.repeat(1_200_000) })
      expect(res.status).toBeGreaterThanOrEqual(400)
    } finally {
      await app.close()
    }
  })

  it('happy: wires cookies, the catch-all filter, CORS for WEB_URL and the trust-proxy hop count', () => {
    process.env.WEB_URL = 'https://app.example.test'
    process.env.TRUST_PROXY = '1'
    const app = fakeApp()
    configure(app)

    const [cookieMiddleware] = app.use.mock.calls[0] as [(req: Request, res: Response, next: () => void) => void]
    const req = { headers: { cookie: 'mnemra_at=test-access-token' } } as unknown as Request
    const next = jest.fn()
    cookieMiddleware(req, {} as Response, next)
    expect(req.cookies).toEqual({ mnemra_at: 'test-access-token' })
    expect(next).toHaveBeenCalledTimes(1)

    expect(app.useGlobalFilters.mock.calls[0][0]).toBeInstanceOf(AllExceptionsFilter)
    expect(app.enableCors).toHaveBeenCalledWith({ origin: 'https://app.example.test', credentials: true })
    expect(app.set).toHaveBeenCalledWith('trust proxy', 1)
  })
})
