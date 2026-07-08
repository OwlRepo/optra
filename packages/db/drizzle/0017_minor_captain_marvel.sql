DO $$ BEGIN
 CREATE TYPE "background_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "document_review_flag_status" AS ENUM('open', 'dismissed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"kind" text NOT NULL,
	"status" "background_run_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"last_error" text,
	"stats" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_review_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"ticket_id" uuid,
	"score" real,
	"reason" text NOT NULL,
	"status" "document_review_flag_status" DEFAULT 'open' NOT NULL,
	"dismissed_at" timestamp,
	"dismissed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_runs_kind_created_idx" ON "background_runs" ("kind","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_runs_workspace_kind_idx" ON "background_runs" ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_flags_workspace_status_idx" ON "document_review_flags" ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_review_flags_document_idx" ON "document_review_flags" ("document_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "background_runs" ADD CONSTRAINT "background_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_review_flags" ADD CONSTRAINT "document_review_flags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_review_flags" ADD CONSTRAINT "document_review_flags_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_review_flags" ADD CONSTRAINT "document_review_flags_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_review_flags" ADD CONSTRAINT "document_review_flags_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
