ALTER TABLE "accounts" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_reconciled_balance" double precision;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reconciled" boolean DEFAULT false NOT NULL;