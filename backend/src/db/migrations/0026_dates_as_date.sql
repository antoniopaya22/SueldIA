-- Fechas de texto («YYYY-MM-DD») a tipo date. Antes de la fase 1 se podían
-- guardar fechas imposibles (p. ej. «2025-02-30» de una importación): en vez
-- de hacer fallar la migración, se ajustan al último día de su mes; lo que no
-- tiene forma de fecha queda vacío (o, si la columna es obligatoria, la fecha
-- en que se creó la fila).
CREATE OR REPLACE FUNCTION pg_temp.sueldia_safe_date(value text) RETURNS date AS $$
DECLARE
  y int; m int; d int;
BEGIN
  IF value IS NULL OR value !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  y := substr(value, 1, 4)::int;
  m := substr(value, 6, 2)::int;
  d := substr(value, 9, 2)::int;
  IF m < 1 OR m > 12 OR d < 1 THEN RETURN NULL; END IF;
  RETURN make_date(y, m, least(d, extract(day FROM (make_date(y, m, 1) + interval '1 month - 1 day'))::int));
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "date" SET DATA TYPE date USING coalesce(pg_temp.sueldia_safe_date("date"), "created_at"::date);--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "scheduled_for" SET DATA TYPE date USING pg_temp.sueldia_safe_date("scheduled_for");--> statement-breakpoint
ALTER TABLE "recurring_transactions" ALTER COLUMN "start_date" SET DATA TYPE date USING coalesce(pg_temp.sueldia_safe_date("start_date"), "created_at"::date);--> statement-breakpoint
ALTER TABLE "recurring_transactions" ALTER COLUMN "end_date" SET DATA TYPE date USING pg_temp.sueldia_safe_date("end_date");--> statement-breakpoint
ALTER TABLE "recurring_skips" ALTER COLUMN "scheduled_for" SET DATA TYPE date USING coalesce(pg_temp.sueldia_safe_date("scheduled_for"), "created_at"::date);--> statement-breakpoint
ALTER TABLE "savings_goals" ALTER COLUMN "target_date" SET DATA TYPE date USING pg_temp.sueldia_safe_date("target_date");
