DO $$ BEGIN
 CREATE TYPE "scrape_run_status" AS ENUM('queued', 'running', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scrape_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"knowledge_base_id" uuid NOT NULL,
	"seed_url" text NOT NULL,
	"status" "scrape_run_status" DEFAULT 'queued' NOT NULL,
	"max_depth" integer NOT NULL,
	"max_pages" integer NOT NULL,
	"pages_found" integer DEFAULT 0 NOT NULL,
	"pages_succeeded" integer DEFAULT 0 NOT NULL,
	"pages_failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_kb_source_url_unique" ON "documents" ("knowledge_base_id","source_url");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
