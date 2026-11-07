import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;

export async function migrateDatabase({ logger = console } = {}) {
  const sql = readFileSync(fileURLToPath(new URL('../sql/schema.sql', import.meta.url)), 'utf8');
  await pool.query(sql);

  try {
    const { rows } = await pool.query('SELECT current_database() AS db');
    await pool.query(`ALTER DATABASE ${quoteIdent(rows[0].db)} SET timezone TO '${config.tz.replace(/'/g, "''")}'`);
  } catch (err) {
    logger.warn?.(`Could not set the database time zone (${err.message}). The app still sets it per connection.`);
  }

  logger.info?.('Schema applied.');
}

export const query = (text, params) => pool.query(text, params);

export async function ensureDefaultAdmin({ logger = console } = {}) {
  const email = process.env.ADMIN_EMAIL || 'admin@manzili.property';
  const password = process.env.ADMIN_PASSWORD || 'manzili254';
  const hash = await bcrypt.hash(password, 12);

  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, 'Administrator', 'admin')
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name,
       role = EXCLUDED.role,
       is_active = TRUE,
       updated_at = now()
     RETURNING id, email`,
    [email, hash]
  );

  logger.info?.(`Admin ready: ${email}`);
  return rows[0];
}

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
