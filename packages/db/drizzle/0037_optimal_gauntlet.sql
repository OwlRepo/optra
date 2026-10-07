DO $$ BEGIN
 CREATE TYPE "billing_plan" AS ENUM('solo', 'team');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ls_subscription_id" varchar(64) NOT NULL,
	"ls_customer_id" varchar(64) NOT NULL,
	"ls_variant_id" varchar(64) NOT NULL,
	"plan" "billing_plan" NOT NULL,
	"status" varchar(32) NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"renews_at" timestamp,
	"ends_at" timestamp,
	"ls_updated_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" varchar(64) NOT NULL,
	"body_sha256" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "trial_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_subscriptions_workspace_id_unique" ON "workspace_subscriptions" ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_subscriptions_ls_subscription_id_unique" ON "workspace_subscriptions" ("ls_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_events_body_sha256_unique" ON "billing_events" ("body_sha256");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
