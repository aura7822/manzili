import { pool, migrateDatabase } from '../src/db.js';

try {
  await migrateDatabase();
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
