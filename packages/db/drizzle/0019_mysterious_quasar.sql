CREATE TABLE IF NOT EXISTS "workspace_digest_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"slack_webhook_url" text,
	"slack_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_digest_settings_workspace_id_unique" ON "workspace_digest_settings" ("workspace_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_digest_settings" ADD CONSTRAINT "workspace_digest_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
