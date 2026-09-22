CREATE TABLE IF NOT EXISTS "goods_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"grn_number" varchar(200),
	"storage_key" text,
	"source_kind" varchar(20) DEFAULT 'csv' NOT NULL,
	"status" "procurement_doc_status" DEFAULT 'pending' NOT NULL,
	"queue_job_id" text,
	"enqueued_at" timestamp,
	"processing_started_at" timestamp,
	"row_count" integer,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goods_receipt_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"goods_receipt_id" uuid NOT NULL,
	"line_number" integer,
	"sku" varchar(200),
	"description" text,
	"quantity_received" numeric,
	"quantity_accepted" numeric,
	"quantity_rejected" numeric,
	"uom" varchar(20),
	"raw_row" jsonb,
	"source_sheet" varchar(200),
	"source_row" integer,
	"source_kind" varchar(20) DEFAULT 'csv' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipts_workspace_created_idx" ON "goods_receipts" ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipts_workspace_po_idx" ON "goods_receipts" ("workspace_id","purchase_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_line_items_goods_receipt_idx" ON "goods_receipt_line_items" ("goods_receipt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_line_items_workspace_sku_idx" ON "goods_receipt_line_items" ("workspace_id","sku");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_line_items" ADD CONSTRAINT "goods_receipt_line_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goods_receipt_line_items" ADD CONSTRAINT "goods_receipt_line_items_goods_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
