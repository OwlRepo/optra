ALTER TABLE "purchase_orders" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_workspace_vendor_idx" ON "purchase_orders" ("workspace_id","vendor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_workspace_po_idx" ON "invoices" ("workspace_id","purchase_order_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
