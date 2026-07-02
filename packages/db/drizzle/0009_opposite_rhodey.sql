DO $$ BEGIN
 CREATE TYPE "workspace_event_type" AS ENUM('document_ingested', 'document_failed', 'scrape_completed', 'scrape_failed', 'ticket_extracted', 'ticket_failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" "workspace_event_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "events_seen_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_events" ADD CONSTRAINT "workspace_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(issue_summary, '')), 'B')
  ) STORED;
--> statement-breakpoint
CREATE INDEX tickets_search_vector_idx ON tickets USING GIN (search_vector);
--> statement-breakpoint
ALTER TABLE chat_messages ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;
--> statement-breakpoint
CREATE INDEX chat_messages_search_vector_idx ON chat_messages USING GIN (search_vector);
