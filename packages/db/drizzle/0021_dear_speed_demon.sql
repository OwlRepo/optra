DO $$ BEGIN
 CREATE TYPE "catalog_doc_status" AS ENUM('pending', 'processing', 'done', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "catalog_match_status" AS ENUM('open', 'dismissed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "catalog_match_type" AS ENUM('sourcing', 'compliance');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(300) NOT NULL,
	"contact_info" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"source_kind" varchar(20) DEFAULT 'upload' NOT NULL,
	"storage_key" text,
	"seed_url" text,
	"status" "catalog_doc_status" DEFAULT 'pending' NOT NULL,
	"queue_job_id" text,
	"enqueued_at" timestamp,
	"processing_started_at" timestamp,
	"row_count" integer,
	"last_error" text,
	"pages_found" integer,
	"pages_succeeded" integer,
	"pages_failed" integer,
	"last_progress_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"catalog_id" uuid NOT NULL,
	"line_number" integer,
	"sku" varchar(200),
	"description" text,
	"photo_storage_key" text,
	"source_page_number" integer,
	"raw_row" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"match_type" "catalog_match_type" NOT NULL,
	"query_po_line_item_id" uuid,
	"query_invoice_line_item_id" uuid,
	"catalog_item_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"score" numeric,
	"is_match" boolean NOT NULL,
	"reason" text NOT NULL,
	"status" "catalog_match_status" DEFAULT 'open' NOT NULL,
	"dismissed_at" timestamp,
	"dismissed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendors_workspace_name_idx" ON "vendors" ("workspace_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogs_workspace_vendor_idx" ON "catalogs" ("workspace_id","vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalogs_workspace_created_idx" ON "catalogs" ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_items_catalog_idx" ON "catalog_items" ("catalog_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_items_workspace_sku_idx" ON "catalog_items" ("workspace_id","sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_matches_workspace_status_idx" ON "catalog_matches" ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_matches_item_idx" ON "catalog_matches" ("catalog_item_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendors" ADD CONSTRAINT "vendors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_matches" ADD CONSTRAINT "catalog_matches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_matches" ADD CONSTRAINT "catalog_matches_query_po_line_item_id_po_line_items_id_fk" FOREIGN KEY ("query_po_line_item_id") REFERENCES "po_line_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_matches" ADD CONSTRAINT "catalog_matches_query_invoice_line_item_id_invoice_line_items_id_fk" FOREIGN KEY ("query_invoice_line_item_id") REFERENCES "invoice_line_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_matches" ADD CONSTRAINT "catalog_matches_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_matches" ADD CONSTRAINT "catalog_matches_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_matches" ADD CONSTRAINT "catalog_matches_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
