import Redis from 'ioredis'
import { backfillTicketEmbeddings } from '@repo/ai'

async function bumpCacheVersions(workspaceIds: string[]): Promise<void> {
  if (workspaceIds.length === 0) {
    return
  }

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
  })

  try {
    for (const workspaceId of workspaceIds) {
      await redis.incr(`chat:ver:${workspaceId}`)
    }
  } finally {
    await redis.quit()
  }
}

backfillTicketEmbeddings()
  .then(async (result) => {
    console.log(result)
    await bumpCacheVersions(result.changedWorkspaceIds)
    process.exit(0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
