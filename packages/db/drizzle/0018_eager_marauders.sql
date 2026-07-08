DO $$ BEGIN
 CREATE TYPE "faq_draft_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "faq_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"ticket_ids" jsonb NOT NULL,
	"cluster_size" integer NOT NULL,
	"status" "faq_draft_status" DEFAULT 'pending' NOT NULL,
	"document_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "faq_drafts_workspace_status_idx" ON "faq_drafts" ("workspace_id","status","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "faq_drafts" ADD CONSTRAINT "faq_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "faq_drafts" ADD CONSTRAINT "faq_drafts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "faq_drafts" ADD CONSTRAINT "faq_drafts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
