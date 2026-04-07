import fs from 'node:fs/promises';
import path from 'node:path';

import { Pool } from 'pg';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set before applying the Postgres schema.');
  }

  const schemaPath = path.resolve(process.cwd(), 'server', 'db', 'schema.sql');
  const schemaSql = await fs.readFile(schemaPath, 'utf8');
  const shouldUseSsl =
    process.env.DATABASE_SSL === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.DATABASE_SSL !== 'false');
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: shouldUseSsl ? { rejectUnauthorized } : undefined,
  });

  try {
    await pool.query(schemaSql);
    console.log(`Applied Postgres schema from ${schemaPath}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
