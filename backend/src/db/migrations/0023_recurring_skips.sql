CREATE TABLE "recurring_skips" (
	"id" serial PRIMARY KEY NOT NULL,
	"recurring_transaction_id" integer NOT NULL,
	"scheduled_for" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recurring_skips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recurring_skips" ADD CONSTRAINT "recurring_skips_recurring_transaction_id_recurring_transactions_id_fk" FOREIGN KEY ("recurring_transaction_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_skips_rule_date_idx" ON "recurring_skips" USING btree ("recurring_transaction_id","scheduled_for");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE recurring_skips FROM anon, authenticated;
    REVOKE ALL ON SEQUENCE recurring_skips_id_seq FROM anon, authenticated;
  END IF;
END
$$;
