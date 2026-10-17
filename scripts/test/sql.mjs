// Dev/test-only: run a SQL statement against the PGlite wire server and print
// the rows as JSON. Used by the e2e suite to seed known tokens and to assert
// database state. Retries the connection a few times (PGlite multiplexes one
// backend, so a busy app pool can briefly reject newcomers).
//
//   node scripts/test/sql.mjs "SELECT * FROM \"User\""

import pg from 'pg';

const sql = process.argv[2];
if (!sql) {
  console.error('usage: node scripts/test/sql.mjs "<sql>"');
  process.exit(1);
}

const config = {
  host: '127.0.0.1',
  port: Number(process.env.PGLITE_PORT || 5433),
  user: 'postgres',
  database: 'postgres',
};

let lastErr;
for (let attempt = 1; attempt <= 5; attempt++) {
  const client = new pg.Client(config);
  try {
    await client.connect();
    const res = await client.query(sql);
    console.log(JSON.stringify(res.rows, null, 2));
    await client.end();
    process.exit(0);
  } catch (err) {
    lastErr = err;
    try { await client.end(); } catch { /* already dead */ }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
}
console.error('sql.mjs failed after retries:', lastErr?.message);
process.exit(1);
