import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { unlinkSync } from 'fs'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { StorageService } from './storage.service'

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
