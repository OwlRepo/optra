DO $$ BEGIN
 CREATE TYPE "ticket_edit_state" AS ENUM('accepted', 'heavily_edited');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "ticket_severity" AS ENUM('low', 'medium', 'high');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "ticket_status" AS ENUM('pending', 'processing', 'done', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "ticket_usefulness" AS ENUM('useful', 'not_useful');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"transcript" text NOT NULL,
	"transcript_hash" varchar(64) NOT NULL,
	"title" text,
	"issue_summary" text,
	"repro_steps" text,
	"severity" "ticket_severity",
	"product_area" text DEFAULT 'general' NOT NULL,
	"hypothesized_root_cause" text,
	"next_action" text,
	"status" "ticket_status" DEFAULT 'pending' NOT NULL,
	"queue_job_id" text,
	"enqueued_at" timestamp,
	"processing_started_at" timestamp,
	"last_error" text,
	"field_confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"usefulness" "ticket_usefulness",
	"edit_state" "ticket_edit_state",
	"feedback_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_transcript_hash_idx" ON "tickets" ("transcript_hash");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
