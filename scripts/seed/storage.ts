// Object-storage writes for the seeder (catalog photos, dataset CSVs).
//
// Mirrors apps/api/src/storage/storage.service.ts exactly — same env vars, same
// client options — so a seeded object is indistinguishable from one the app
// uploaded itself. Deliberately a thin standalone client rather than importing
// the Nest service, which would drag in the whole DI container.
import { HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

let client: S3Client | null = null

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for the seeder's storage step`)
  return value
}

export function s3Bucket(): string {
  return process.env.S3_BUCKET ?? 'optra-documents'
}

function getClient(): S3Client {
  if (client) return client
  client = new S3Client({
    // Host runs talk to the compose port mapping (8433); inside the container
    // compose sets S3_ENDPOINT=http://seaweedfs:8333.
    endpoint: process.env.SEED_S3_ENDPOINT ?? requireEnv('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: requireEnv('S3_ACCESS_KEY'),
      secretAccessKey: requireEnv('S3_SECRET_KEY'),
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  })
  return client
}

/** True when object storage is reachable and the bucket exists. */
export async function storageAvailable(): Promise<boolean> {
  try {
    await getClient().send(new HeadBucketCommand({ Bucket: s3Bucket() }))
    return true
  } catch {
    return false
  }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({ Bucket: s3Bucket(), Key: key, Body: body, ContentType: contentType }),
  )
}

export function closeStorage(): void {
  client?.destroy()
  client = null
}
