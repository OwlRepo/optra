DO $$ BEGIN
 CREATE TYPE "dataset_status" AS ENUM('pending', 'processing', 'done', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"storage_key" text,
	"description" text,
	"description_embedding" vector(1536),
	"columns_schema" jsonb,
	"row_count" integer,
	"content_hash" varchar(64),
	"status" "dataset_status" DEFAULT 'pending' NOT NULL,
	"queue_job_id" text,
	"enqueued_at" timestamp,
	"processing_started_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "datasets" ADD CONSTRAINT "datasets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
