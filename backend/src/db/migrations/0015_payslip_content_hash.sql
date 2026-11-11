ALTER TABLE "payslips" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "payslips_profile_hash_idx" ON "payslips" USING btree ("profile_id","content_hash");--> statement-breakpoint
-- Nóminas ya subidas: mismo hash que calcula el backend (sha256 hex del texto en UTF-8).
UPDATE "payslips" SET "content_hash" = encode(sha256(convert_to("raw_text", 'UTF8')), 'hex') WHERE "raw_text" IS NOT NULL;--> statement-breakpoint
-- Las que se quedaron en "pending" (la función murió a mitad de subida) no
-- tienen texto ni se pueden reprocesar: pasan a "error" para que se vean y
-- se puedan borrar. La subida ya no deja filas en "pending".
UPDATE "payslips" SET "parsing_status" = 'error' WHERE "parsing_status" = 'pending';
