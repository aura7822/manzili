import { jobs } from '../src/jobs.js';
import { pool } from '../src/db.js';

const name = process.argv[2];
if (!jobs[name]) {
  console.error(`Usage: npm run job -- <${Object.keys(jobs).join('|')}>`);
  process.exit(1);
}

try {
  console.log(await jobs[name]());
} finally {
  await pool.end();
}
