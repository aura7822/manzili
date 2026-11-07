import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, signStaffToken } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { unauthorized } from '../util/errors.js';
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
