import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db.js';
import { requirePayToken, signPayToken } from '../middleware/auth.js';
import { logActivity, maskPhone } from '../services/activity.js';
import { mpesa } from '../services/mpesa.js';
import { paymentContext } from '../services/payments.js';
import { renderReceipt } from '../services/pdf.js';
import { kes } from '../util/format.js';
import { badRequest, conflict, HttpError, notFound } from '../util/errors.js';
import { isMpesaNumber, normalizePhone } from '../util/phone.js';
import { parse, uuid } from '../util/validate.js';

const router = Router();

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});

const payLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many payment requests. Please wait a minute.' },
});

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Units that currently have an active lease (numbers only, no tenant data). */
router.get('/properties/:slug/units', async (req, res) => {
  const { rows } = await query(
    `SELECT p.name AS property_name, u.id, u.unit_number
       FROM properties p
       JOIN units u ON u.property_id = p.id
      WHERE p.slug = $1
        AND EXISTS (SELECT 1 FROM leases l WHERE l.unit_id = u.id AND l.status = 'active')
      ORDER BY u.floor_number, u.unit_number`,
    [req.params.slug]
  );
  if (rows.length === 0) {
    const prop = await query('SELECT name FROM properties WHERE slug = $1', [req.params.slug]);
    if (!prop.rows[0]) throw notFound('Property not found');
    return res.json({ property_name: prop.rows[0].name, units: [] });
  }
  res.json({ property_name: rows[0].property_name, units: rows.map((r) => ({ id: r.id, unit_number: r.unit_number })) });
});

/** Verify unit + registered phone. Same error for every failure so nothing leaks. */
router.post('/verify', verifyLimiter, async (req, res) => {
  const b = parse(z.object({ slug: z.string().min(1).max(100), unit_id: uuid, phone: z.string().min(7).max(20) }), req.body);
  const phone = normalizePhone(b.phone);

  const { rows } = await query(
    `SELECT l.id AS lease_id, t.phone, t.full_name, u.unit_number
       FROM leases l
       JOIN units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       JOIN tenants t ON t.id = l.tenant_id
      WHERE p.slug = $1 AND u.id = $2 AND l.status = 'active'`,
    [b.slug, b.unit_id]
  );
  const lease = rows[0];
  if (!lease || !safeEqual(lease.phone, phone)) {
    throw new HttpError(422, 'We could not verify those details. Please check the house number and the phone number on your tenancy.');
  }
  res.json({
    token: signPayToken(lease.lease_id),
    tenant_name: lease.full_name.split(' ')[0],
    unit_number: lease.unit_number,
  });
});

/** Oldest open invoice for the verified lease. */
router.get('/invoice', requirePayToken, async (req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.invoice_number, i.billing_period, i.due_date, i.amount_due, i.amount_paid,
            (i.amount_due - i.amount_paid) AS balance, i.status, u.unit_number
       FROM invoices i JOIN leases l ON l.id = i.lease_id JOIN units u ON u.id = l.unit_id
      WHERE i.lease_id = $1 AND i.status IN ('pending', 'partial', 'overdue')
      ORDER BY i.due_date LIMIT 1`,
    [req.leaseId]
  );
  res.json({ invoice: rows[0] ?? null });
});

router.post('/pay/mpesa', requirePayToken, payLimiter, async (req, res) => {
  const b = parse(
    z.object({ invoice_id: uuid, amount: z.coerce.number().int().min(1).max(1000000), phone: z.string().min(7).max(20) }),
    req.body
  );
  const phone = normalizePhone(b.phone);
  if (!isMpesaNumber(phone)) throw badRequest('Enter a valid M-Pesa number such as 0712 345 678 or 0112 345 678.');
  if (!mpesa.isConfigured()) throw new HttpError(503, 'Online M-Pesa payments are not available right now.');

  const { rows } = await query(
    `SELECT i.id, i.invoice_number, i.status, (i.amount_due - i.amount_paid) AS balance
       FROM invoices i WHERE i.id = $1 AND i.lease_id = $2`,
    [b.invoice_id, req.leaseId]
  );
  const invoice = rows[0];
  if (!invoice || !['pending', 'partial', 'overdue'].includes(invoice.status)) throw notFound('No open invoice found.');
  if (b.amount > Math.ceil(Number(invoice.balance))) throw badRequest('Amount is more than the balance due.');

  const recent = await query(
    `SELECT 1 FROM transactions WHERE invoice_id = $1 AND status = 'pending' AND initiated_at > now() - interval '90 seconds'`,
    [invoice.id]
  );
  if (recent.rowCount > 0) throw conflict('A payment request is already in progress. Check your phone.');

  const created = await query(
    `INSERT INTO transactions (invoice_id, method, amount, status, payer_phone)
     VALUES ($1, 'mpesa', $2, 'pending', $3) RETURNING id`,
    [invoice.id, b.amount, phone]
  );
  const txnId = created.rows[0].id;

  try {
    const result = await mpesa.stkPush({
      phone, amount: b.amount, reference: invoice.invoice_number, description: 'Rent',
    });
    if (String(result?.ResponseCode) !== '0' || !result.CheckoutRequestID) {
      throw new Error(result?.errorMessage || result?.ResponseDescription || 'M-Pesa rejected the request');
    }
    await query('UPDATE transactions SET checkout_request_id = $2 WHERE id = $1', [txnId, result.CheckoutRequestID]);
    const ctx = await paymentContext(txnId);
    await logActivity({
      category: 'mpesa', action: 'stk_sent',
      message: `M-Pesa prompt for ${kes(b.amount)} sent to ${maskPhone(phone)} (${ctx?.tenant_name}, house ${ctx?.unit_number}).`,
      meta: { transaction_id: txnId, checkout_request_id: result.CheckoutRequestID },
      propertyId: ctx?.property_id,
    });
  } catch (err) {
    console.error('STK push failed:', err.message);
    await query(`UPDATE transactions SET status = 'failed', failure_reason = $2 WHERE id = $1`, [txnId, err.message.slice(0, 500)]);
    const ctx = await paymentContext(txnId);
    await logActivity({
      category: 'mpesa', action: 'stk_failed',
      message: `M-Pesa prompt to ${maskPhone(phone)} could not be sent (${ctx?.tenant_name}, house ${ctx?.unit_number}): ${err.message}`,
      meta: { transaction_id: txnId }, propertyId: ctx?.property_id,
    });
    throw new HttpError(502, 'We could not start the M-Pesa prompt. Please try again in a moment.');
  }

  res.status(201).json({ transaction_id: txnId, message: 'Check your phone and enter your M-Pesa PIN.' });
});

router.get('/pay/status/:id', requirePayToken, async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const { rows } = await query(
    `SELECT x.id, x.status, x.amount, x.receipt_number, x.failure_reason,
            i.status AS invoice_status, (i.amount_due - i.amount_paid) AS balance
       FROM transactions x JOIN invoices i ON i.id = x.invoice_id
      WHERE x.id = $1 AND i.lease_id = $2`,
    [id, req.leaseId]
  );
  if (!rows[0]) throw notFound('Transaction not found');
  res.json(rows[0]);
});

/** Receipt PDF; the receipt number contains a random suffix, so it is not guessable. */
router.get('/receipts/:number', async (req, res) => {
  const { rows } = await query(
    `SELECT x.receipt_number, x.amount, x.method, x.provider_reference,
            to_char(x.paid_at, 'DD Mon YYYY HH24:MI') AS paid_at_label,
            to_char(i.billing_period, 'Mon YYYY') AS period_label,
            (i.amount_due - i.amount_paid) AS balance,
            u.unit_number, p.name AS property_name, t.full_name AS tenant_name
       FROM transactions x
       JOIN invoices i ON i.id = x.invoice_id
       JOIN leases l ON l.id = i.lease_id
       JOIN units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       JOIN tenants t ON t.id = l.tenant_id
      WHERE x.receipt_number = $1 AND x.status = 'success'`,
    [req.params.number]
  );
  if (!rows[0]) throw notFound('Receipt not found');
  renderReceipt(res, rows[0]);
});

export default router;
