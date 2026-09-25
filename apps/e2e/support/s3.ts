import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { S3_BUCKET, S3_ENDPOINT, S3_REGION, s3Credentials } from './env'

// Direct access to the bucket the e2e API writes to. Tests use it to prove what
// the product cannot show: that bytes really left storage on delete, and what
// the product does when a file it expects has gone.

let client: S3Client | undefined

function s3(): S3Client {
  client ??= new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    forcePathStyle: true,
    credentials: s3Credentials(),
  })
  return client
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }))
    return true
  } catch (error: any) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false
    throw error
  }
}

export async function removeObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }))
}

/**
 * Empties the harness bucket (creating it if needed). The bucket is used by
 * nothing but this suite, and the database it describes was just recreated,
 * so anything left in it is from an earlier run.
 */
export async function resetBucket(): Promise<void> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
  } catch {
    await s3().send(new CreateBucketCommand({ Bucket: S3_BUCKET }))
    return
  }
  let token: string | undefined
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: S3_BUCKET, ContinuationToken: token }),
    )
    const keys = (page.Contents ?? []).map((object) => ({ Key: object.Key! }))
    if (keys.length > 0) {
      await s3().send(new DeleteObjectsCommand({ Bucket: S3_BUCKET, Delete: { Objects: keys } }))
    }
    token = page.NextContinuationToken
  } while (token)
}
