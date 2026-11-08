import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, signStaffToken } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { conflict, unauthorized } from '../util/errors.js';
import { parse } from '../util/validate.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
});

// Used to keep response time similar when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/register', loginLimiter, async (req, res) => {
  const { full_name, email, password } = parse(
    z.object({
      full_name: z.string().trim().min(2).max(150),
      email: z.string().trim().email(),
      password: z.string().min(8).max(128),
    }),
    req.body
  );

  const { rows: existingRows } = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (existingRows[0]) {
    throw conflict('An account with that email already exists.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, 'landlord')
     RETURNING id, email, full_name, role`,
    [email, passwordHash, full_name]
  );

  const user = rows[0];
  await logActivity({ category: 'auth', action: 'account_created', message: `${user.full_name} created a landlord account.`, actorId: user.id });
  res.status(201).json({
    token: signStaffToken(user),
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
  });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);

  const { rows } = await query(
    'SELECT id, email, full_name, role, password_hash FROM users WHERE lower(email) = lower($1) AND is_active = TRUE',
    [email]
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    await logActivity({ category: 'auth', action: 'login_failed', message: `Failed sign-in attempt for ${email}.` });
    throw unauthorized('That email or password is not right. Please try again.');
  }

  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await logActivity({ category: 'auth', action: 'login', message: `${user.full_name} signed in.`, actorId: user.id });
  res.json({
    token: signStaffToken(user),
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
  });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default router;
