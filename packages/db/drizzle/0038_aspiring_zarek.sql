DO $$ BEGIN
 CREATE TYPE "usage_kind" AS ENUM('matched_line', 'photo_check', 'llm_cost');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "usage_kind" NOT NULL,
	"quantity" bigint NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"model" varchar(64),
	"idempotency_key" varchar(128) NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_workspace_kind_occurred_idx" ON "usage_events" ("workspace_id","kind","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "usage_events_idempotency_key_unique" ON "usage_events" ("idempotency_key");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
