import { IsISO4217CurrencyCode, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

/**
 * Header metadata the user supplies when uploading an invoice (S3b).
 *
 * `purchaseOrderId` is required: POLICY v1 #2 says "when uploading an invoice
 * or GRN, the user selects the PO", and a PO number read out of the document is
 * advisory and never auto-links. This forces PO-before-invoice ordering, which
 * is intended — S5's goods-receipt upload inherits the same rule.
 */
export class UploadInvoiceDto {
  @IsUUID()
  purchaseOrderId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  invoiceNumber!: string

  @IsISO4217CurrencyCode()
  currency!: string
}
