ALTER TYPE "discrepancy_flag_type" ADD VALUE IF NOT EXISTS 'short_receipt';--> statement-breakpoint
ALTER TYPE "discrepancy_flag_type" ADD VALUE IF NOT EXISTS 'invoice_exceeds_received';--> statement-breakpoint
ALTER TYPE "discrepancy_flag_type" ADD VALUE IF NOT EXISTS 'uom_mismatch';--> statement-breakpoint
ALTER TYPE "discrepancy_flag_type" ADD VALUE IF NOT EXISTS 'currency_mismatch';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comparison_run_goods_receipts" (
	"comparison_run_id" uuid NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	CONSTRAINT "comparison_run_goods_receipts_comparison_run_id_goods_receipt_id_pk" PRIMARY KEY("comparison_run_id","goods_receipt_id")
);
--> statement-breakpoint
ALTER TABLE "comparison_runs" ADD COLUMN "goods_receipt_line_count" integer;--> statement-breakpoint
ALTER TABLE "discrepancy_flags" ADD COLUMN "goods_receipt_line_item_id" uuid;--> statement-breakpoint
ALTER TABLE "discrepancy_flags" ADD COLUMN "received_value" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comparison_run_goods_receipts_receipt_idx" ON "comparison_run_goods_receipts" ("goods_receipt_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_flags" ADD CONSTRAINT "discrepancy_flags_goods_receipt_line_item_id_goods_receipt_line_items_id_fk" FOREIGN KEY ("goods_receipt_line_item_id") REFERENCES "goods_receipt_line_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comparison_run_goods_receipts" ADD CONSTRAINT "comparison_run_goods_receipts_comparison_run_id_comparison_runs_id_fk" FOREIGN KEY ("comparison_run_id") REFERENCES "comparison_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comparison_run_goods_receipts" ADD CONSTRAINT "comparison_run_goods_receipts_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
