ALTER TABLE "purchase_orders" ADD COLUMN "review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "detected_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "page_count" smallint;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "detected_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "page_count" smallint;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "detected_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "page_count" smallint;--> statement-breakpoint
ALTER TABLE "po_line_items" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "po_line_items" ADD COLUMN "edited_by" uuid;--> statement-breakpoint
ALTER TABLE "po_line_items" ADD COLUMN "extracted_values" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "edited_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN "extracted_values" jsonb;--> statement-breakpoint
ALTER TABLE "goods_receipt_line_items" ADD COLUMN "extraction_confidence" numeric;--> statement-breakpoint
ALTER TABLE "goods_receipt_line_items" ADD COLUMN "extractor_version" varchar(40);--> statement-breakpoint
ALTER TABLE "goods_receipt_line_items" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "goods_receipt_line_items" ADD COLUMN "edited_by" uuid;--> statement-breakpoint
ALTER TABLE "goods_receipt_line_items" ADD COLUMN "extracted_values" jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_line_items" ADD CONSTRAINT "goods_receipt_line_items_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
