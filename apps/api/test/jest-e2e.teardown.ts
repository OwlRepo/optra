// Removes the per-worker Bull namespaces created by jest-e2e.setup.ts.
//
// Each e2e worker sets BULL_PREFIX=bull-e2e-<pid> so its queues cannot be
// consumed by a sibling worker or by a running `optra-api` dev container.
// Those keys are inert once the run ends, but without this they accumulate in
// the dev Redis forever - a slow leak introduced by the isolation fix itself.
// Scoped strictly to the `bull-e2e-*` pattern, so the real `bull:*` production
// namespace is never touched.
import { resolve } from 'path'
import { config as loadEnv } from 'dotenv'
import Redis from 'ioredis'

// globalTeardown runs OUTSIDE setupFiles and outside any Nest ConfigModule, so
// nothing has loaded the root .env yet. Without this the defaults below point
// at 6379 while this repo's dev Redis is published on 6380, and cleanup dies
// with ECONNREFUSED.
loadEnv({ path: resolve(__dirname, '../../../.env') })

export default async function globalTeardown() {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  })

  try {
    await redis.connect()
    let cursor = '0'
    let removed = 0
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'bull-e2e-*', 'COUNT', 500)
      cursor = next
      if (keys.length > 0) {
        await redis.del(...keys)
        removed += keys.length
      }
    } while (cursor !== '0')
    if (removed > 0) console.log(`[e2e teardown] removed ${removed} bull-e2e-* keys`)
  } catch (error) {
    // Never fail a green test run over cleanup of throwaway keys.
    console.warn('[e2e teardown] Bull namespace cleanup skipped:', (error as Error).message)
  } finally {
    redis.disconnect()
  }
}
