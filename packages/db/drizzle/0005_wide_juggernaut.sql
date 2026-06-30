ALTER TABLE "documents" ADD COLUMN "queue_job_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "enqueued_at" timestamp;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD COLUMN "queue_job_id" text;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD COLUMN "enqueued_at" timestamp;