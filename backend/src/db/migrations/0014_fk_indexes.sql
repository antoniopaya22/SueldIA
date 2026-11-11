CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alert_history_user_idx" ON "alert_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_history_payslip_idx" ON "alert_history" USING btree ("payslip_id");--> statement-breakpoint
CREATE INDEX "alert_rules_user_idx" ON "alert_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "categories_group_idx" ON "categories" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "category_groups_user_idx" ON "category_groups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "category_rules_category_idx" ON "category_rules" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "payslip_notes_payslip_idx" ON "payslip_notes" USING btree ("payslip_id");--> statement-breakpoint
CREATE INDEX "payslip_tags_tag_idx" ON "payslip_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "profiles_user_idx" ON "profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_transactions_user_idx" ON "recurring_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_transactions_account_idx" ON "recurring_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "recurring_transactions_category_idx" ON "recurring_transactions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "tags_user_idx" ON "tags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_transfer_idx" ON "transactions" USING btree ("transfer_id");