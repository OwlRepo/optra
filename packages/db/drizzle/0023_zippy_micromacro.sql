DO $$ BEGIN
 CREATE TYPE "discrepancy_decision_outcome" AS ENUM('false_positive', 'approved_exception', 'vendor_dispute', 'resolved');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discrepancy_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"discrepancy_flag_id" uuid NOT NULL,
	"comparison_run_id" uuid,
	"actor_user_id" uuid,
	"actor_role" varchar(20) NOT NULL,
	"outcome" "discrepancy_decision_outcome" NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discrepancy_decisions_flag_created_idx" ON "discrepancy_decisions" ("workspace_id","discrepancy_flag_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_decisions" ADD CONSTRAINT "discrepancy_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_decisions" ADD CONSTRAINT "discrepancy_decisions_discrepancy_flag_id_discrepancy_flags_id_fk" FOREIGN KEY ("discrepancy_flag_id") REFERENCES "discrepancy_flags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_decisions" ADD CONSTRAINT "discrepancy_decisions_comparison_run_id_comparison_runs_id_fk" FOREIGN KEY ("comparison_run_id") REFERENCES "comparison_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_decisions" ADD CONSTRAINT "discrepancy_decisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
