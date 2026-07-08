import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectQueue, Process, Processor } from '@nestjs/bull'
import { Queue } from 'bull'
import { db, workspaces } from '@repo/db'

const FRESHNESS_CRON = process.env.FRESHNESS_CHECK_CRON ?? '0 3 * * 1' // weekly, Monday 03:00

// V2 S2 scheduler substrate applied to F3: one repeatable "tick" fans out one
// Bull job per workspace (small blast radius, per-workspace idempotency),
// per the batch plan's scheduler design. Re-registering the same repeatable
// jobId on every boot is a Bull no-op if the cron is unchanged.
@Injectable()
@Processor('freshness-tick-queue')
export class FreshnessTickProcessor implements OnModuleInit {
  private readonly logger = new Logger(FreshnessTickProcessor.name)

  constructor(
    @InjectQueue('freshness-tick-queue') private readonly tickQueue: Queue,
    @InjectQueue('freshness-check-queue') private readonly checkQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.tickQueue.add(
      {},
      { jobId: 'freshness-tick', repeat: { cron: FRESHNESS_CRON }, removeOnComplete: true },
    )
  }

  @Process()
  async onTick() {
    const rows = await db.select({ id: workspaces.id }).from(workspaces)
    const weekStamp = new Date().toISOString().slice(0, 10)

    for (const row of rows) {
      const jobId = `freshness-check:${row.id}:${weekStamp}`
      await this.checkQueue.add(
        { workspaceId: row.id },
        { jobId, attempts: 2, removeOnComplete: true, removeOnFail: false },
      )
    }

    this.logger.log(`Freshness tick fanned out to ${rows.length} workspace(s)`)
  }
}
