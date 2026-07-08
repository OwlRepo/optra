ALTER TABLE "tickets" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
