import { randomUUID } from 'crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'
import { datasets, db } from '@repo/db'
import { StorageService } from '../storage/storage.service'
import { DatasetProfilingService } from './dataset-profiling.service'

@Injectable()
export class DatasetsService {
  private readonly logger = new Logger(DatasetsService.name)

  constructor(
    private readonly storage: StorageService,
    private readonly profiling: DatasetProfilingService,
  ) {}

  async upload(workspaceId: string, file: Express.Multer.File) {
    const storageKey = `${workspaceId}/datasets/${randomUUID()}-${file.originalname}`
    await this.storage.save(storageKey, file.buffer, file.mimetype)

    const [dataset] = await db
      .insert(datasets)
      .values({
        workspaceId,
        name: file.originalname,
        storageKey,
        status: 'pending',
      })
      .returning()

    try {
      await this.profiling.queueDataset(dataset.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db
        .update(datasets)
        .set({
          status: 'failed',
          lastError: `Queue enqueue failed: ${message}`,
          updatedAt: new Date(),
        })
        .where(eq(datasets.id, dataset.id))
      this.logger.error(`Dataset upload enqueue failed datasetId=${dataset.id}: ${message}`)
      throw error
    }

    return { id: dataset.id, name: dataset.name, status: dataset.status }
  }

  async list(workspaceId: string) {
    return db
      .select({
        id: datasets.id,
        name: datasets.name,
        status: datasets.status,
        rowCount: datasets.rowCount,
        description: datasets.description,
        lastError: datasets.lastError,
        createdAt: datasets.createdAt,
      })
      .from(datasets)
      .where(eq(datasets.workspaceId, workspaceId))
      .orderBy(desc(datasets.createdAt))
  }

  async remove(workspaceId: string, datasetId: string): Promise<{ message: string }> {
    const [dataset] = await db.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1)

    if (!dataset || dataset.workspaceId !== workspaceId) {
      throw new NotFoundException('Dataset not found')
    }

    if (dataset.storageKey) {
      await this.storage.delete(dataset.storageKey).catch((error: unknown) => {
        this.logger.warn(
          `Failed to delete storage object ${dataset.storageKey}: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
    }

    await db.delete(datasets).where(eq(datasets.id, datasetId))

    return { message: 'Dataset deleted' }
  }
}
