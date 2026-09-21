import { IsISO4217CurrencyCode, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

/**
 * Header metadata the user supplies when uploading a purchase order (S3b).
 *
 * These arrive as multipart TEXT fields alongside the file, so every property
 * is a string — the global ValidationPipe runs without `transform`, and none of
 * these need coercion.
 *
 * All three are required. POLICY v1 #3 says the PO "carries an explicit
 * vendorId chosen from the workspace's existing vendors", and nothing in the
 * repo extracts document-level metadata, so the only way these get filled is by
 * asking. The underlying columns stay nullable for rows written before
 * migration 0025 — requiredness lives here, never in the schema.
 */
export class UploadPurchaseOrderDto {
  @IsUUID()
  vendorId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  poNumber!: string

  // Deliberately strict rather than free text: POLICY v1 #6 sends a currency
  // mismatch between compared documents to review, and that comparison is only
  // meaningful if "usd" and "USD" cannot both exist. The client uppercases
  // before sending.
  @IsISO4217CurrencyCode()
  currency!: string
}
