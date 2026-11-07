import crypto from 'node:crypto';
import { query, withTx } from '../db.js';
import { kes } from '../util/format.js';
import { logActivity } from './activity.js';
import { emit } from './events.js';
import { sendReceipt } from './notifications.js';

const receiptNumber = (txnId) =>
  `RCP-${new Date().getFullYear()}-${String(txnId).padStart(6, '0')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

/** Everything we want to say about a transaction (for logs and live events). */
export async function paymentContext(txnId) {
  const { rows } = await query(
    `SELECT x.id, x.amount, x.method, x.status, x.receipt_number, x.provider_reference, x.payer_phone, x.paid_at,
            i.invoice_number, i.status AS invoice_status, (i.amount_due - i.amount_paid) AS balance,
            u.unit_number, t.full_name AS tenant_name, p.id AS property_id, p.owner_id
       FROM transactions x
       JOIN invoices i ON i.id = x.invoice_id
       JOIN leases l ON l.id = i.lease_id
       JOIN units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       JOIN tenants t ON t.id = l.tenant_id
      WHERE x.id = $1`,
    [txnId]
  );
  return rows[0] ?? null;
}

/**
 * Mark a transaction successful and credit its invoice.
 * Atomic and idempotent: a repeated call for an already-successful transaction does nothing.
 * All money arithmetic happens in PostgreSQL NUMERIC, never in JS floats.
 *
 * @returns {{ txn: object, applied: boolean }}
 */
export async function markSuccess(txnId, { reference = null, amount = null, paidAt = null, actorId = null } = {}) {
  const result = await withTx(async (db) => {
    const { rows } = await db.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [txnId]);
    const txn = rows[0];
    if (!txn) throw new Error(`Transaction ${txnId} not found`);
    if (txn.status === 'success') return { txn, applied: false };

    await db.query('SELECT id FROM invoices WHERE id = $1 FOR UPDATE', [txn.invoice_id]);

    const updated = await db.query(
      `UPDATE transactions
          SET status = 'success',
              amount = COALESCE($2::numeric, amount),
              provider_reference = COALESCE($3, provider_reference),
              paid_at = COALESCE($4::timestamptz, now()),
              receipt_number = COALESCE(receipt_number, $5),
              failure_reason = NULL
        WHERE id = $1
        RETURNING *`,
      [txnId, amount, reference, paidAt, receiptNumber(txnId)]
    );

    await db.query(
      `UPDATE invoices
          SET amount_paid = amount_paid + $2::numeric,
              status = CASE
                WHEN status = 'void' THEN status
                WHEN amount_paid + $2::numeric >= amount_due THEN 'paid'::invoice_status
                WHEN due_date < CURRENT_DATE THEN 'overdue'::invoice_status
                ELSE 'partial'::invoice_status
              END
        WHERE id = $1`,
      [txn.invoice_id, updated.rows[0].amount]
    );

    return { txn: updated.rows[0], applied: true };
  });

  if (result.applied) {
    const ctx = await paymentContext(result.txn.id);
    if (ctx) {
      const fullyPaid = ctx.invoice_status === 'paid';
      await logActivity({
        category: 'payment',
        action: 'payment_received',
        message: `${ctx.tenant_name} (house ${ctx.unit_number}) paid ${kes(ctx.amount)} by ${String(ctx.method).replace('_', ' ')}. ${
          fullyPaid ? 'Rent fully paid.' : `Balance ${kes(ctx.balance)}.`
        }`,
        meta: { transaction_id: ctx.id, receipt: ctx.receipt_number, reference: ctx.provider_reference },
        actorId,
        propertyId: ctx.property_id,
      });
      emit('payment', {
        id: ctx.id, tenant_name: ctx.tenant_name, unit_number: ctx.unit_number, amount: ctx.amount,
        method: ctx.method, fully_paid: fullyPaid, balance: ctx.balance, paid_at: ctx.paid_at,
      }, ctx.owner_id);
    }
    sendReceipt(result.txn.id).catch((err) => console.error('Receipt send failed:', err.message));
  }
  return result;
}

/** Handle the Body.stkCallback object from Safaricom. */
export async function applyStkCallback(callback) {
  const checkoutId = String(callback?.CheckoutRequestID ?? '');
  if (!checkoutId) return;

  const { rows } = await query('SELECT id, status FROM transactions WHERE checkout_request_id = $1', [checkoutId]);
  const txn = rows[0];

  if (!txn) {
    await logActivity({
      category: 'mpesa', action: 'callback_unmatched',
      message: `M-Pesa sent a result for an unknown request (${checkoutId}): ${callback.ResultDesc ?? 'no description'}.`,
      meta: { checkout_request_id: checkoutId, result_code: callback.ResultCode },
    });
    return;
  }
  if (txn.status === 'success') return;

  const ctx = await paymentContext(txn.id);
  const code = Number(callback.ResultCode ?? -1);
  const where = ctx ? `${ctx.tenant_name}, house ${ctx.unit_number}` : `request ${checkoutId}`;

  if (code !== 0) {
    await query(`UPDATE transactions SET status = $2, failure_reason = $3 WHERE id = $1 AND status = 'pending'`, [
      txn.id,
      code === 1032 ? 'cancelled' : 'failed',
      String(callback.ResultDesc ?? 'Payment failed').slice(0, 500),
    ]);
    await logActivity({
      category: 'mpesa', action: code === 1032 ? 'callback_cancelled' : 'callback_failed',
      message: `M-Pesa message (${where}): ${callback.ResultDesc ?? 'payment failed'} (code ${code}).`,
      meta: { checkout_request_id: checkoutId, result_code: code },
      propertyId: ctx?.property_id,
    });
    return;
  }

  const items = Object.fromEntries((callback.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value]));
  const rawDate = String(items.TransactionDate ?? '');
  const paidAt = /^\d{14}$/.test(rawDate)
    ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}T${rawDate.slice(8, 10)}:${rawDate.slice(10, 12)}:${rawDate.slice(12, 14)}+03:00`
    : null;
  const receipt = items.MpesaReceiptNumber ? String(items.MpesaReceiptNumber) : null;

  await logActivity({
    category: 'mpesa', action: 'callback_success',
    message: `M-Pesa confirmed ${kes(items.Amount ?? ctx?.amount)} (${where}). M-Pesa receipt ${receipt ?? 'n/a'}.`,
    meta: { checkout_request_id: checkoutId, receipt },
    propertyId: ctx?.property_id,
  });

  await markSuccess(txn.id, {
    reference: receipt,
    amount: items.Amount !== undefined ? String(items.Amount) : null,
    paidAt,
  });
}

/** Process a stored webhook event. Safe to call more than once. */
export async function processStkEvent(eventId) {
  const { rows } = await query('SELECT * FROM webhook_events WHERE id = $1', [eventId]);
  const event = rows[0];
  if (!event || event.processed) return;

  try {
    await applyStkCallback(event.payload?.Body?.stkCallback);
    await query('UPDATE webhook_events SET processed = TRUE, processed_at = now(), error = NULL WHERE id = $1', [eventId]);
  } catch (err) {
    await query('UPDATE webhook_events SET error = $2 WHERE id = $1', [eventId, err.message]);
    throw err;
  }
}

/** Record a payment taken outside the gateway (cash, bank, manual M-Pesa). */
export async function recordManual({ invoiceId, amount, method, reference, userId }) {
  const { rows } = await query(
    `INSERT INTO transactions (invoice_id, method, amount, status, recorded_by)
     VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
    [invoiceId, method, amount, userId]
  );
  const cleanRef = reference && reference.trim() ? reference.trim() : null;
  return markSuccess(rows[0].id, { reference: cleanRef, amount, actorId: userId });
}
