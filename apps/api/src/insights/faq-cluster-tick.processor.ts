import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectQueue, Process, Processor } from '@nestjs/bull'
import { Queue } from 'bull'
import { db, workspaces } from '@repo/db'

const FAQ_CLUSTER_CRON = process.env.FAQ_CLUSTER_CRON ?? '0 4 * * 1' // weekly, Monday 04:00

// Same S2 scheduler substrate as FreshnessTickProcessor, one repeatable tick
// fanning out one per-workspace job.
@Injectable()
@Processor('faq-cluster-tick-queue')
export class FaqClusterTickProcessor implements OnModuleInit {
  private readonly logger = new Logger(FaqClusterTickProcessor.name)

  constructor(
    @InjectQueue('faq-cluster-tick-queue') private readonly tickQueue: Queue,
    @InjectQueue('faq-cluster-queue') private readonly clusterQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.tickQueue.add(
      {},
      { jobId: 'faq-cluster-tick', repeat: { cron: FAQ_CLUSTER_CRON }, removeOnComplete: true },
    )
  }

  @Process()
  async onTick() {
    const rows = await db.select({ id: workspaces.id }).from(workspaces)
    const weekStamp = new Date().toISOString().slice(0, 10)

    for (const row of rows) {
      const jobId = `faq-cluster:${row.id}:${weekStamp}`
      await this.clusterQueue.add(
        { workspaceId: row.id },
        { jobId, attempts: 2, removeOnComplete: true, removeOnFail: false },
      )
    }

    this.logger.log(`FAQ cluster tick fanned out to ${rows.length} workspace(s)`)
  }
}
