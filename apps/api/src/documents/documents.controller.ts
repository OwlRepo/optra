import { Controller, Get, Post, Body } from '@nestjs/common'
import { DocumentsService } from './documents.service'

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  findAll() {
    return this.documentsService.findAll()
  }

  @Post()
  create(@Body() data: any) {
    return this.documentsService.create(data)
  }
}
