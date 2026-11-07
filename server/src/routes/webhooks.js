import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import { processStkEvent } from '../services/payments.js';

const router = Router();

const secretMatches = (given) => {
  const expected = config.mpesa.webhookSecret;
  if (!expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * M-Pesa STK Push result callback.
 * 1) authenticate by secret path, 2) persist the raw event (unique => replay safe),
 * 3) acknowledge immediately, 4) process in the background.
 */
router.post('/mpesa/:secret/stk', async (req, res) => {
  if (!secretMatches(req.params.secret)) return res.sendStatus(404);

  const checkoutId = req.body?.Body?.stkCallback?.CheckoutRequestID;
  if (!checkoutId) return res.json({ ResultCode: 0, ResultDesc: 'Ignored' });

  const { rows } = await query(
    `INSERT INTO webhook_events (provider, event_id, payload)
     VALUES ('mpesa_stk', $1, $2)
     ON CONFLICT (provider, event_id) DO NOTHING
     RETURNING id`,
    [String(checkoutId), req.body]
  );

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  if (rows[0]) {
    setImmediate(() => processStkEvent(rows[0].id).catch((err) => console.error('Webhook processing failed:', err.message)));
  }
});

export default router;
