import { Injectable } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'
import { db, vendors } from '@repo/db'
import { CreateVendorDto } from './dto/create-vendor.dto'

@Injectable()
export class VendorsService {
  async create(workspaceId: string, dto: CreateVendorDto) {
    const [vendor] = await db
      .insert(vendors)
      .values({ workspaceId, name: dto.name, contactInfo: dto.contactInfo })
      .returning()

    return { id: vendor.id, name: vendor.name }
  }

  async list(workspaceId: string) {
    return db
      .select({
        id: vendors.id,
        name: vendors.name,
        contactInfo: vendors.contactInfo,
        createdAt: vendors.createdAt,
      })
      .from(vendors)
      .where(eq(vendors.workspaceId, workspaceId))
      .orderBy(desc(vendors.createdAt))
  }
}
