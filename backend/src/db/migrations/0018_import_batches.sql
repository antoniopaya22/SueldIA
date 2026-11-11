ALTER TABLE "transactions" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
CREATE INDEX "transactions_import_batch_idx" ON "transactions" USING btree ("user_id","import_batch_id");