ALTER TABLE "po_line_items" ADD COLUMN "source_sheet" varchar(200);--> statement-breakpoint
ALTER TABLE "po_line_items" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "po_line_items" ADD COLUMN "uom" varchar(20);--> statement-breakpoint
ALTER TABLE "po_line_items" ADD COLUMN "extraction_confidence" numeric;--> statement-breakpoint
ALTER TABLE "po_line_items" ADD COLUMN "extractor_version" varchar(40);--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "source_sheet" varchar(200);--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "source_row" integer;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "uom" varchar(20);--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "extraction_confidence" numeric;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "extractor_version" varchar(40);
--> statement-breakpoint
-- Backfill the new typed confidence from where it has been living all along:
-- inside the raw_row jsonb blob, written by the PDF path but unqueryable there.
-- Guarded on the key existing and the column still being null, so re-running is
-- a no-op. CSV/XLSX rows never carried a confidence and stay null.
-- Same shape as 0011_sticky_scream.sql's backfill of chunks from metadata.
UPDATE "po_line_items"
  SET "extraction_confidence" = ("raw_row" ->> 'confidence')::numeric
  WHERE "extraction_confidence" IS NULL
    AND "raw_row" ? 'confidence'
    AND jsonb_typeof("raw_row" -> 'confidence') = 'number';--> statement-breakpoint
UPDATE "invoice_line_items"
  SET "extraction_confidence" = ("raw_row" ->> 'confidence')::numeric
  WHERE "extraction_confidence" IS NULL
    AND "raw_row" ? 'confidence'
    AND jsonb_typeof("raw_row" -> 'confidence') = 'number';
