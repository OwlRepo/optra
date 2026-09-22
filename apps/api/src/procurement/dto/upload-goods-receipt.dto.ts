import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

/**
 * Header metadata supplied when uploading a goods receipt (S5).
 *
 * Multipart TEXT fields alongside the file, so both properties are strings —
 * the global ValidationPipe runs without `transform` and neither needs it.
 *
 * `purchaseOrderId` is required, and the column behind it is NOT NULL: POLICY
 * v1 #2 says the user selects the PO, and a receipt that answers no order is
 * not evidence of anything. This forces PO-before-receipt ordering, which is
 * the same rule the invoice upload inherited in S3b.
 *
 * There is deliberately no `currency` — a receipt records what arrived, not
 * what it cost (POLICY v1 #1, hard stop #1).
 */
export class UploadGoodsReceiptDto {
  @IsUUID()
  purchaseOrderId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  grnNumber!: string
}
