import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name)
  private client: S3Client | null = null

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucket()
    } catch (error) {
      this.logger.error(
        `Object storage unavailable; bucket bootstrap failed`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }

  async save(key: string, body: Buffer, contentType?: string): Promise<string> {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )

    return key
  }

  async getBuffer(key: string): Promise<Buffer> {
    const response = await this.getClient().send(
      new GetObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      }),
    )

    if (!response.Body) {
      throw new Error(`No object body returned for ${key}`)
    }

    const chunks: Buffer[] = []
    for await (const chunk of this.toReadable(response.Body)) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
    }

    return Buffer.concat(chunks)
  }

  async getToTempFile(key: string): Promise<string> {
    const response = await this.getClient().send(
      new GetObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      }),
    )

    if (!response.Body) {
      throw new Error(`No object body returned for ${key}`)
    }

    const filePath = join(tmpdir(), `mnemra-${randomUUID()}-${basename(key)}`)
    await mkdir(tmpdir(), { recursive: true })

    await pipeline(this.toReadable(response.Body), createWriteStream(filePath))

    return filePath
  }

  async delete(key: string): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({
        Bucket: this.getBucket(),
        Key: key,
      }),
    )
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.getClient().send(new HeadBucketCommand({ Bucket: this.getBucket() }))
      return
    } catch (error) {
      if (!this.isMissingBucketError(error)) {
        throw error
      }
    }

    try {
      await this.getClient().send(new CreateBucketCommand({ Bucket: this.getBucket() }))
    } catch (error) {
      if (!this.isAlreadyExistsError(error)) {
        throw error
      }
    }
  }

  private requireConfig(key: string): string {
    const value = this.config.get<string>(key)
    if (!value) {
      throw new Error(`Missing required storage config: ${key}`)
    }
    return value
  }

  private getClient(): S3Client {
    if (this.client) {
      return this.client
    }

    const endpoint = this.requireConfig('S3_ENDPOINT')
    const region = this.requireConfig('S3_REGION')
    const accessKeyId = this.requireConfig('S3_ACCESS_KEY')
    const secretAccessKey = this.requireConfig('S3_SECRET_KEY')

    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: this.config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
    })

    return this.client
  }

  private getBucket(): string {
    return this.requireConfig('S3_BUCKET')
  }

  private isMissingBucketError(error: unknown): boolean {
    const code = this.errorCode(error)
    return code === 'NotFound' || code === 'NoSuchBucket' || code === '404'
  }

  private isAlreadyExistsError(error: unknown): boolean {
    const code = this.errorCode(error)
    return code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists'
  }

  private errorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined
    const candidate = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } }
    return candidate.name ?? candidate.Code ?? candidate.$metadata?.httpStatusCode?.toString()
  }

  private toReadable(body: unknown): Readable {
    if (body instanceof Readable) {
      return body
    }

    if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
      return Readable.from(body as AsyncIterable<Uint8Array>)
    }

    if (body && typeof body === 'object' && 'transformToWebStream' in body) {
      return Readable.fromWeb(
        (body as { transformToWebStream(): import('stream/web').ReadableStream }).transformToWebStream(),
      )
    }

    throw new Error('Unsupported S3 body stream type')
  }
}
