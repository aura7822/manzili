import './env.js';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';

export async function resetDb() {
  await pool.query(readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
  await pool.query(`TRUNCATE activity_log, archives, maintenance_spend, notifications, webhook_events, transactions,
                    invoices, leases, tenants, units, properties, users RESTART IDENTITY CASCADE`);
}

export async function createUser(email, role, password = 'Passw0rd!x') {
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, hash, `${role} user`, role]
  );
  return rows[0].id;
}

export async function startServer() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { body, token, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, type };
  }

  const close = async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  };
  return { call, close, base };
}

export const login = async (call, email, password = 'Passw0rd!x') =>
  (await call('POST', '/api/auth/login', { body: { email, password } })).data.token;

export { pool, query };
