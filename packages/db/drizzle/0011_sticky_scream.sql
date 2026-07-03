ALTER TABLE "chunks" ADD COLUMN "source_type" varchar(32);--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "doc_type" varchar(64);--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "product_area" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_workspace_source_type_idx" ON "chunks" ("workspace_id","source_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_workspace_doc_type_idx" ON "chunks" ("workspace_id","doc_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_workspace_product_area_idx" ON "chunks" ("workspace_id","product_area");--> statement-breakpoint
-- Backfill source_type from the existing parent relation.
UPDATE "chunks" SET "source_type" = CASE
  WHEN "ticket_id" IS NOT NULL THEN 'ticket'
  WHEN "metadata" ->> 'source' = 'web' OR "metadata" ->> 'sourceType' = 'web' THEN 'web'
  ELSE 'document'
END WHERE "source_type" IS NULL;--> statement-breakpoint
-- Backfill doc_type / product_area from existing chunk metadata where present.
UPDATE "chunks" SET "doc_type" = "metadata" ->> 'fileType'
  WHERE "doc_type" IS NULL AND "metadata" ->> 'fileType' IS NOT NULL;--> statement-breakpoint
UPDATE "chunks" SET "product_area" = "metadata" ->> 'productArea'
  WHERE "product_area" IS NULL AND "metadata" ->> 'productArea' IS NOT NULL;--> statement-breakpoint
-- Approximate-nearest-neighbour index so retrieval stops sequentially scanning
-- every workspace chunk. Cosine ops match the `1 - (embedding <=> vec)` score.
CREATE INDEX IF NOT EXISTS "chunks_embedding_hnsw_idx" ON "chunks"
  USING hnsw ("embedding" vector_cosine_ops);