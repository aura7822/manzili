import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';

const sql = readFileSync(fileURLToPath(new URL('../sql/schema.sql', import.meta.url)), 'utf8');
const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;

try {
  await pool.query(sql);

  // Make Africa/Nairobi (or TZ) the database default, so "today" is right on every connection,
  // including Neon's pooled endpoint which ignores connection-level options.
  try {
    const { rows } = await pool.query('SELECT current_database() AS db');
    await pool.query(`ALTER DATABASE ${quoteIdent(rows[0].db)} SET timezone TO '${config.tz.replace(/'/g, "''")}'`);
  } catch (err) {
    console.warn(`Could not set the database time zone (${err.message}). The app still sets it per connection.`);
  }
  console.log('Schema applied.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
