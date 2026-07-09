DO $$ BEGIN
 CREATE TYPE "procurement_doc_status" AS ENUM('pending', 'processing', 'done', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "discrepancy_flag_status" AS ENUM('open', 'dismissed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "discrepancy_flag_type" AS ENUM('quantity_mismatch', 'price_mismatch', 'missing_on_invoice', 'missing_on_po');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"po_number" varchar(200),
	"currency" varchar(10),
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
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"invoice_number" varchar(200),
	"currency" varchar(10),
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
CREATE TABLE IF NOT EXISTS "po_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_number" integer,
	"sku" varchar(200),
	"description" text,
	"quantity" numeric,
	"unit_price" numeric,
	"line_total" numeric,
	"raw_row" jsonb,
	"source_kind" varchar(20) DEFAULT 'csv' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_number" integer,
	"sku" varchar(200),
	"description" text,
	"quantity" numeric,
	"unit_price" numeric,
	"line_total" numeric,
	"raw_row" jsonb,
	"source_kind" varchar(20) DEFAULT 'csv' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discrepancy_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"po_line_item_id" uuid,
	"invoice_line_item_id" uuid,
	"sku" varchar(200),
	"flag_type" "discrepancy_flag_type" NOT NULL,
	"po_value" text,
	"invoice_value" text,
	"delta" numeric,
	"reason" text NOT NULL,
	"status" "discrepancy_flag_status" DEFAULT 'open' NOT NULL,
	"dismissed_at" timestamp,
	"dismissed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_workspace_created_idx" ON "purchase_orders" ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_workspace_created_idx" ON "invoices" ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_line_items_purchase_order_idx" ON "po_line_items" ("purchase_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_line_items_workspace_sku_idx" ON "po_line_items" ("workspace_id","sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_line_items_invoice_idx" ON "invoice_line_items" ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_line_items_workspace_sku_idx" ON "invoice_line_items" ("workspace_id","sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discrepancy_flags_workspace_status_idx" ON "discrepancy_flags" ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discrepancy_flags_po_invoice_idx" ON "discrepancy_flags" ("purchase_order_id","invoice_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "po_line_items" ADD CONSTRAINT "po_line_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_flags" ADD CONSTRAINT "discrepancy_flags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_flags" ADD CONSTRAINT "discrepancy_flags_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_flags" ADD CONSTRAINT "discrepancy_flags_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_flags" ADD CONSTRAINT "discrepancy_flags_po_line_item_id_po_line_items_id_fk" FOREIGN KEY ("po_line_item_id") REFERENCES "po_line_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_flags" ADD CONSTRAINT "discrepancy_flags_invoice_line_item_id_invoice_line_items_id_fk" FOREIGN KEY ("invoice_line_item_id") REFERENCES "invoice_line_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_flags" ADD CONSTRAINT "discrepancy_flags_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
