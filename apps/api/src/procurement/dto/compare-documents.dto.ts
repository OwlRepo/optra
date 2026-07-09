import { IsUUID } from 'class-validator'

export class CompareDocumentsDto {
  @IsUUID()
  purchaseOrderId!: string

  @IsUUID()
  invoiceId!: string
}
