import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectQueue, Process, Processor } from '@nestjs/bull'
import { Queue } from 'bull'
import { db, workspaces } from '@repo/db'

const TOPIC_GAP_CRON = process.env.TOPIC_GAP_CRON ?? '0 5 * * 1' // weekly, Monday 05:00

// Same S2 scheduler substrate as FreshnessTickProcessor/FaqClusterTickProcessor.
@Injectable()
@Processor('topic-gap-tick-queue')
export class TopicGapTickProcessor implements OnModuleInit {
  private readonly logger = new Logger(TopicGapTickProcessor.name)

  constructor(
    @InjectQueue('topic-gap-tick-queue') private readonly tickQueue: Queue,
    @InjectQueue('topic-gap-queue') private readonly gapQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.tickQueue.add(
      {},
      { jobId: 'topic-gap-tick', repeat: { cron: TOPIC_GAP_CRON }, removeOnComplete: true },
    )
  }

  @Process()
  async onTick() {
    const rows = await db.select({ id: workspaces.id }).from(workspaces)
    const weekStamp = new Date().toISOString().slice(0, 10)

    for (const row of rows) {
      const jobId = `topic-gap:${row.id}:${weekStamp}`
      await this.gapQueue.add(
        { workspaceId: row.id },
        { jobId, attempts: 2, removeOnComplete: true, removeOnFail: false },
      )
    }

    this.logger.log(`Topic gap tick fanned out to ${rows.length} workspace(s)`)
  }
}
