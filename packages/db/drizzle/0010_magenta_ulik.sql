ALTER TABLE "chunks" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_exactly_one_parent_check" CHECK (("document_id" IS NOT NULL) <> ("ticket_id" IS NOT NULL));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chunks_ticket_id_unique_idx" ON "chunks" ("ticket_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chunks" ADD CONSTRAINT "chunks_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
