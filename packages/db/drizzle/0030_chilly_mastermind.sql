CREATE TABLE IF NOT EXISTS "vendor_price_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"sku" varchar(200) NOT NULL,
	"sku_key" varchar(200) NOT NULL,
	"uom" varchar(20),
	"unit_price" numeric NOT NULL,
	"currency" varchar(10) NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"source_reference" text,
	"supersedes_id" uuid,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_price_terms_lookup_idx" ON "vendor_price_terms" ("workspace_id","vendor_id","sku_key","effective_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_price_terms_workspace_vendor_idx" ON "vendor_price_terms" ("workspace_id","vendor_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_price_terms" ADD CONSTRAINT "vendor_price_terms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_price_terms" ADD CONSTRAINT "vendor_price_terms_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_price_terms" ADD CONSTRAINT "vendor_price_terms_supersedes_id_vendor_price_terms_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "vendor_price_terms"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_price_terms" ADD CONSTRAINT "vendor_price_terms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
