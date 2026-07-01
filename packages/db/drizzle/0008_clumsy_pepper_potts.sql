DROP INDEX IF EXISTS "tickets_transcript_hash_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_workspace_transcript_hash_idx" ON "tickets" ("workspace_id","transcript_hash");