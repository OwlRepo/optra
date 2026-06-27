import { Injectable } from '@nestjs/common'
// import { db } from '@repo/db'
// import type { Document } from '@repo/types'

@Injectable()
export class DocumentsService {
  async findAll() {
    // TODO: Implement with Drizzle
    return []
  }

  async create(data: any) {
    // TODO: Implement document creation and trigger ingestion
    return { id: 'placeholder', ...data }
  }
}
