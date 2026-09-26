import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { unlinkSync } from 'fs'
import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { StorageService } from './storage.service'
import { StorageObjectNotFoundError } from './storage.errors'

// This is a REAL integration test: it round-trips bytes through the configured
// S3-compatible endpoint (SeaweedFS locally), so it is gated on S3_ENDPOINT and
// skips cleanly where no object store exists.
//
// The .env load is what makes the gate meaningful. The unit Jest config has no
// setupFiles, and nothing else loads dotenv before collection, so S3_ENDPOINT
// was never set here even though it IS defined in the repo's root .env - the
// suite therefore skipped on every local run and had never once executed
// (verified 2026-08-18; it passes 3/3 once the endpoint is actually visible).
// Loading here rather than in the shared Jest config is deliberate: a global
// .env load would also hand all 58 other unit suites live credentials, notably
// EMAIL_OTP_ENABLED, which the e2e setup goes out of its way to force off.
loadEnv({ path: resolve(__dirname, '../../../../.env') })

const describeStorage = process.env.S3_ENDPOINT ? describe : describe.skip

describeStorage('StorageService', () => {
  let service: StorageService

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [StorageService],
    }).compile()

    service = moduleRef.get(StorageService)
    await service.onModuleInit()
  })

  it('save -> getToTempFile -> delete round-trips bytes and delete makes key unreadable', async () => {
    const key = `spec/${randomUUID()}.txt`
    const body = Buffer.from('seaweed roundtrip')

    await expect(service.save(key, body, 'text/plain')).resolves.toBe(key)

    const tempPath = await service.getToTempFile(key)
    await expect(readFile(tempPath)).resolves.toEqual(body)
    unlinkSync(tempPath)

    await expect(service.delete(key)).resolves.toBeUndefined()
    await expect(service.getToTempFile(key)).rejects.toThrow()
  })

  it('getBuffer returns the exact stored bytes', async () => {
    const key = `spec/${randomUUID()}.txt`
    const body = Buffer.from('buffer roundtrip bytes')

    await service.save(key, body, 'text/plain')
    await expect(service.getBuffer(key)).resolves.toEqual(body)

    await service.delete(key)
  })

  it('ensureBucket is idempotent', async () => {
    await expect(service.onModuleInit()).resolves.toBeUndefined()
  })

  it('getObject returns the Content-Type the object was saved with', async () => {
    const key = `spec/${randomUUID()}.png`
    await service.save(key, Buffer.from('png-ish'), 'image/png')

    await expect(service.getObject(key)).resolves.toEqual({
      buffer: Buffer.from('png-ish'),
      contentType: 'image/png',
    })

    await service.delete(key)
  })

  // A real S3 answer for a key that is not there. Every reader must turn it
  // into one named error the callers can branch on - and never leak the key,
  // because procurement copies an error's message into the client-visible
  // `lastError`.
  it.each(['getBuffer', 'getObject', 'getToTempFile'] as const)(
    '%s rejects a missing key with StorageObjectNotFoundError, key kept off the message',
    async (method) => {
      const key = `spec/missing-${randomUUID()}.txt`

      const error = await service[method](key).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(StorageObjectNotFoundError)
      expect((error as StorageObjectNotFoundError).key).toBe(key)
      expect((error as Error).message).not.toContain(key)
      expect((error as Error).message).not.toContain('spec/')
    },
  )
})

// The same classification, pinned without an object store, so it runs in
// every environment. The S3 SDK reports a missing object in more than one
// shape depending on the implementation; a missing BUCKET is a configuration
// fault and must stay a 500, so it is deliberately not treated as "missing
// object" even though it is also a 404.
describe('StorageService missing-object classification', () => {
  function serviceRejectingWith(error: unknown): StorageService {
    const config = { get: (key: string) => ({ S3_BUCKET: 'bucket' })[key] } as unknown as ConfigService
    const service = new StorageService(config)
    ;(service as unknown as { client: unknown }).client = { send: jest.fn().mockRejectedValue(error) }
    return service
  }

  it.each([
    ['NoSuchKey', { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }],
    ['NotFound', { name: 'NotFound', $metadata: { httpStatusCode: 404 } }],
  ])('maps %s to StorageObjectNotFoundError', async (_label, sdkError) => {
    await expect(serviceRejectingWith(sdkError).getBuffer('k')).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    )
  })

  it('keeps the SDK error as the cause', async () => {
    const sdkError = { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }
    const error = await serviceRejectingWith(sdkError).getObject('k').catch((caught: unknown) => caught)
    expect((error as Error & { cause?: unknown }).cause).toBe(sdkError)
  })

  it.each([
    ['NoSuchBucket', { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }],
    // A 404 with no missing-object code is a wrong endpoint or a proxy's error
    // page: a configuration fault, retryable, never "your file is gone".
    ['a bare 404', { name: 'UnknownError', $metadata: { httpStatusCode: 404 } }],
    ['AccessDenied', { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }],
    ['a network failure', new Error('connect ECONNREFUSED')],
  ])('leaves %s untouched', async (_label, sdkError) => {
    const error = await serviceRejectingWith(sdkError).getToTempFile('k').catch((caught: unknown) => caught)
    expect(error).toBe(sdkError)
  })
})
