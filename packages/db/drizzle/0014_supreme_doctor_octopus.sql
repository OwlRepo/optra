CREATE TABLE IF NOT EXISTS "chat_query_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"chat_message_id" uuid NOT NULL,
	"question" text NOT NULL,
	"question_embedding" vector(1536),
	"top_score" real,
	"source_count" integer DEFAULT 0 NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"cache_status" varchar(16) NOT NULL,
	"query_class" varchar(32) NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_query_metrics_workspace_created_idx" ON "chat_query_metrics" ("workspace_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_query_metrics" ADD CONSTRAINT "chat_query_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_query_metrics" ADD CONSTRAINT "chat_query_metrics_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chat_query_metrics" ADD CONSTRAINT "chat_query_metrics_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "chat_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
