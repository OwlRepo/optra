DO $$ BEGIN
 CREATE TYPE "comparison_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comparison_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"mode" varchar(20) DEFAULT 'two_way' NOT NULL,
	"strategy_version" integer DEFAULT 1 NOT NULL,
	"status" "comparison_run_status" DEFAULT 'running' NOT NULL,
	"initiated_by" uuid,
	"po_line_count" integer,
	"invoice_line_count" integer,
	"flag_count" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discrepancy_flags" ADD COLUMN "comparison_run_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comparison_runs_workspace_created_idx" ON "comparison_runs" ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comparison_runs_pair_status_idx" ON "comparison_runs" ("purchase_order_id","invoice_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discrepancy_flags_run_idx" ON "discrepancy_flags" ("comparison_run_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_flags" ADD CONSTRAINT "discrepancy_flags_comparison_run_id_comparison_runs_id_fk" FOREIGN KEY ("comparison_run_id") REFERENCES "comparison_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comparison_runs" ADD CONSTRAINT "comparison_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comparison_runs" ADD CONSTRAINT "comparison_runs_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comparison_runs" ADD CONSTRAINT "comparison_runs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "comparison_runs" ADD CONSTRAINT "comparison_runs_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
