ALTER TABLE "category_rules" ADD COLUMN "match_field" text DEFAULT 'payee' NOT NULL;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "transaction_type" text;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "min_amount" double precision;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "max_amount" double precision;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "account_id" integer;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;