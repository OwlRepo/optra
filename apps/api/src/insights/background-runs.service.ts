import { Injectable } from '@nestjs/common'
import { backgroundRuns, db } from '@repo/db'
import { eq } from 'drizzle-orm'

// V2 S2 scheduler substrate: anchors status/lastError for periodic jobs that
// have no natural entity row (unlike documents/datasets). Shared by F3
// (freshness-check), and future F4/F6 kinds.
@Injectable()
export class BackgroundRunsService {
  async start(kind: string, workspaceId: string | null): Promise<string> {
    const [row] = await db
      .insert(backgroundRuns)
      .values({ kind, workspaceId, status: 'running', startedAt: new Date() })
      .returning({ id: backgroundRuns.id })

    return row.id
  }

  async succeed(runId: string, stats: Record<string, unknown>): Promise<void> {
    await db
      .update(backgroundRuns)
      .set({ status: 'succeeded', finishedAt: new Date(), stats })
      .where(eq(backgroundRuns.id, runId))
  }

  async fail(runId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(backgroundRuns)
      .set({ status: 'failed', finishedAt: new Date(), lastError: message })
      .where(eq(backgroundRuns.id, runId))
  }
}
