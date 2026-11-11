-- Marcas de color: las seis de siempre en minúscula (la importación de YNAB
-- las traía como «Red»); cualquier otro texto se descarta.
UPDATE "transactions" SET "flag" = lower(trim("flag")) WHERE "flag" IS NOT NULL;--> statement-breakpoint
UPDATE "transactions" SET "flag" = NULL WHERE "flag" IS NOT NULL AND "flag" NOT IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple');--> statement-breakpoint
UPDATE "recurring_transactions" SET "flag" = lower(trim("flag")) WHERE "flag" IS NOT NULL;--> statement-breakpoint
UPDATE "recurring_transactions" SET "flag" = NULL WHERE "flag" IS NOT NULL AND "flag" NOT IN ('red', 'orange', 'yellow', 'green', 'blue', 'purple');
