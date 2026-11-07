import pg from 'pg';
import { config } from './config.js';

// DATE -> 'YYYY-MM-DD' string (avoids timezone shifts); BIGINT -> Number.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

const isNeon = /neon\.tech/i.test(config.databaseUrl);
// Neon's pooled endpoint ("-pooler" in the host name) does not accept the "options" startup parameter.
// There the time zone comes from the database-level default that `npm run migrate` sets.
const canSetOptions = !/-pooler\./i.test(config.databaseUrl);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX || 10),
  // Neon scales to zero when idle, so the first connection after a pause can take a few seconds.
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 30000,
  keepAlive: true,
  ...(canSetOptions ? { options: `-c timezone=${config.tz}` } : {}),
  // Neon requires TLS; the string's sslmode=require also works, this just makes it the default.
  ...(isNeon ? { ssl: { rejectUnauthorized: true } } : {}),
});

// A dropped idle connection (common when Neon suspends) must not crash the process.
pool.on('error', (err) => console.error('Idle database connection error:', err.message));

export const query = (text, params) => pool.query(text, params);

/** Run fn(client) inside a transaction; commits on success, rolls back on error. */
export async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
