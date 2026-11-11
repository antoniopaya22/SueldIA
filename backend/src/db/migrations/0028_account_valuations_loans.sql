CREATE TABLE "account_valuations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"date" date NOT NULL,
	"value" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_valuations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "loan_principal" double precision;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "loan_rate" double precision;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "loan_term_months" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "loan_start_date" date;--> statement-breakpoint
ALTER TABLE "account_valuations" ADD CONSTRAINT "account_valuations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_valuations" ADD CONSTRAINT "account_valuations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_valuations_user_idx" ON "account_valuations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_valuations_account_date_idx" ON "account_valuations" USING btree ("account_id","date");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE account_valuations FROM anon, authenticated;
    REVOKE ALL ON SEQUENCE account_valuations_id_seq FROM anon, authenticated;
  END IF;
END
$$;
