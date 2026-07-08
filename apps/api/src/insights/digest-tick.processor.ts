import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectQueue, Process, Processor } from '@nestjs/bull'
import { Queue } from 'bull'
import { db, workspaces } from '@repo/db'

const DIGEST_CRON = process.env.DIGEST_CRON ?? '0 6 * * 1' // weekly, Monday 06:00

// Same S2 scheduler substrate as the other tick processors.
@Injectable()
@Processor('digest-tick-queue')
export class DigestTickProcessor implements OnModuleInit {
  private readonly logger = new Logger(DigestTickProcessor.name)

  constructor(
    @InjectQueue('digest-tick-queue') private readonly tickQueue: Queue,
    @InjectQueue('digest-queue') private readonly digestQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.tickQueue.add(
      {},
      { jobId: 'digest-tick', repeat: { cron: DIGEST_CRON }, removeOnComplete: true },
    )
  }

  @Process()
  async onTick() {
    const rows = await db.select({ id: workspaces.id }).from(workspaces)
    const weekStamp = new Date().toISOString().slice(0, 10)

    for (const row of rows) {
      const jobId = `digest:${row.id}:${weekStamp}`
      await this.digestQueue.add(
        { workspaceId: row.id },
        { jobId, attempts: 2, removeOnComplete: true, removeOnFail: false },
      )
    }

    this.logger.log(`Digest tick fanned out to ${rows.length} workspace(s)`)
  }
}
