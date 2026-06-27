import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'

@Injectable()
export class IngestService {
  constructor(
    @InjectQueue('ingest-queue') private ingestQueue: Queue,
  ) {}

  async queueDocument(documentId: string) {
    await this.ingestQueue.add({ documentId })
    return { queued: true, documentId }
  }
}
