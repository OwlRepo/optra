ALTER TABLE "comparison_runs" ADD COLUMN "contract_term_count" integer;--> statement-breakpoint
ALTER TABLE "discrepancy_flags" ADD COLUMN "contract_unit_price" numeric;--> statement-breakpoint
ALTER TABLE "discrepancy_flags" ADD COLUMN "contract_term_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "discrepancy_flags" ADD CONSTRAINT "discrepancy_flags_contract_term_id_vendor_price_terms_id_fk" FOREIGN KEY ("contract_term_id") REFERENCES "vendor_price_terms"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
