import { config } from '../config.js';
import { query, withTx } from '../db.js';
import { logActivity } from './activity.js';
import { mpesa } from './mpesa.js';
import { markSuccess, paymentContext } from './payments.js';
import { sendInvoiceReminder } from './notifications.js';
import { syncUnitStatus } from '../util/sql.js';

/**
 * Create invoices for the given month ('YYYY-MM', default current) for every active lease,
 * or only for `leaseId`. The first invoice of a new tenant is never due before their move-in date.
 */
export async function generateInvoices(month, { leaseId = null, db = null } = {}) {
  const run = db ? db.query.bind(db) : query;
  const { rows } = await run(
    `WITH p AS (
       SELECT COALESCE(to_date($1, 'YYYY-MM'), date_trunc('month', CURRENT_DATE)::date) AS period
     )
     INSERT INTO invoices (invoice_number, lease_id, billing_period, due_date, amount_due)
     SELECT 'INV-' || to_char(p.period, 'YYYYMM') || '-' || upper(substr(replace(l.id::text, '-', ''), 1, 8)),
            l.id, p.period, GREATEST(p.period + (l.rent_due_day - 1), l.start_date), l.rent_amount
       FROM leases l, p
      WHERE l.status = 'active'
        AND ($2::uuid IS NULL OR l.id = $2::uuid)
        AND l.start_date <= (p.period + interval '1 month - 1 day')::date
        AND (l.end_date IS NULL OR l.end_date >= p.period)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [month ?? null, leaseId]
  );
  return rows.length;
}

/** Flag unpaid invoices past due as overdue and expire leases that reached an end date. */
export async function markOverdue() {
  const overdue = await query(
    `UPDATE invoices SET status = 'overdue'
      WHERE status IN ('pending', 'partial') AND due_date < CURRENT_DATE`
  );

  const expired = await withTx(async (db) => {
    const { rows } = await db.query(
      `UPDATE leases SET status = 'expired'
        WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_DATE
        RETURNING unit_id`
    );
    for (const r of rows) await syncUnitStatus(db, r.unit_id);
    return rows.length;
  });

  if (overdue.rowCount > 0) {
    await logActivity({ category: 'system', action: 'marked_overdue', message: `${overdue.rowCount} invoice(s) marked overdue.` });
  }
  return { overdue: overdue.rowCount, expired };
}

/** Due-soon, due-today and overdue reminders. */
export async function sendReminders() {
  const { rows } = await query(
    `SELECT id, (due_date - CURRENT_DATE) AS days
       FROM invoices WHERE status IN ('pending', 'partial', 'overdue')`
  );

  let sent = 0;
  for (const inv of rows) {
    let kind = null;
    if (inv.days === config.reminders.beforeDays) kind = 'due soon';
    else if (inv.days === 0) kind = 'due today';
    else if (inv.days < 0 && config.reminders.overdueDays.includes(-inv.days)) kind = 'overdue';
    if (!kind) continue;

    const dup = await query(
      `SELECT 1 FROM notifications WHERE invoice_id = $1 AND kind = $2 AND created_at::date = CURRENT_DATE`,
      [inv.id, `${kind} reminder`]
    );
    if (dup.rowCount > 0) continue;

    await sendInvoiceReminder(inv.id, kind);
    sent++;
  }
  return { sent };
}

/** Ask M-Pesa about STK pushes still pending after 2 minutes (covers lost callbacks). */
export async function reconcilePending() {
  const { rows } = await query(
    `SELECT id, checkout_request_id FROM transactions
      WHERE method = 'mpesa' AND status = 'pending' AND checkout_request_id IS NOT NULL
        AND initiated_at < now() - interval '2 minutes'
        AND initiated_at > now() - interval '1 day'`
  );

  let resolved = 0;
  for (const t of rows) {
    try {
      const result = await mpesa.stkQuery(t.checkout_request_id);
      if (result?.ResultCode === undefined) continue; // still processing

      const ctx = await paymentContext(t.id);
      const where = ctx ? `${ctx.tenant_name}, house ${ctx.unit_number}` : `request ${t.checkout_request_id}`;

      if (String(result.ResultCode) === '0') {
        // The query response has no M-Pesa receipt code; the callback may still add it later.
        await markSuccess(t.id);
        await logActivity({ category: 'mpesa', action: 'reconciled', message: `Checked with M-Pesa: payment confirmed (${where}).`, propertyId: ctx?.property_id });
      } else {
        await query(`UPDATE transactions SET status = $2, failure_reason = $3 WHERE id = $1 AND status = 'pending'`, [
          t.id,
          String(result.ResultCode) === '1032' ? 'cancelled' : 'failed',
          String(result.ResultDesc ?? 'Payment failed').slice(0, 500),
        ]);
        await logActivity({ category: 'mpesa', action: 'reconciled', message: `Checked with M-Pesa: ${result.ResultDesc ?? 'payment failed'} (${where}).`, propertyId: ctx?.property_id });
      }
      resolved++;
    } catch (err) {
      console.error('Reconcile failed for', t.id, err.message);
    }
  }
  return { checked: rows.length, resolved };
}
