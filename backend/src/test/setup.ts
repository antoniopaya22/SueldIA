// Pruebas de integración contra un Postgres real: solo si se define
// TEST_DATABASE_URL (nunca la de producción — se vacían las tablas). Tiene que
// fijarse antes de que cualquier test importe db/index.ts, por eso va en un
// setupFile. Sin la variable, esas pruebas se saltan (describeDb).
//
//   docker run -d --name sueldia-pg-test -e POSTGRES_PASSWORD=postgres \
//     -e POSTGRES_DB=sueldia_test -p 55432:5432 postgres:16-alpine
//   export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/sueldia_test
//   DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate && npm test
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
