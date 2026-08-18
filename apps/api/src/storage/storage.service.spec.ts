import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { unlinkSync } from 'fs'
import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { StorageService } from './storage.service'

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
})
