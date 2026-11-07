import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { addClient } from '../services/events.js';
import { requireRole } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { emit } from '../services/events.js';
import { recordManual } from '../services/payments.js';
import { badRequest, notFound } from '../util/errors.js';
import { kes } from '../util/format.js';
import { propertyScope } from '../util/sql.js';
import { isoDate, month, money, parse, positiveMoney, uuid } from '../util/validate.js';

const router = Router();
const manage = requireRole('admin', 'landlord');

const MAX_LOOKBACK_DAYS = 14;

/** Today (database time zone) and the allowed look-back window. */
async function resolveDate(input) {
  const { rows } = await query(`SELECT CURRENT_DATE::text AS today, (CURRENT_DATE - ${MAX_LOOKBACK_DAYS})::text AS earliest`);
  const { today, earliest } = rows[0];
  const date = input ?? today;
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw badRequest('That date does not exist. Please pick it from the calendar.');
  if (date > today) throw badRequest('That date is in the future. Pick today or an earlier day.');
  if (date < earliest) throw badRequest('You can only look back up to 2 weeks.');
  return { date, today, earliest, isToday: date === today };
}

// Everything below is rebuilt "as of" the chosen day ($1): payments made by the end of that day,
// invoices that existed then, and tenancies that were running then.
const NEXT_DAY = `($1::date + 1)`;
const MONTH = `date_trunc('month', $1::date)::date`;

const INVOICES_AS_OF = `
  FROM invoices i
  JOIN leases l ON l.id = i.lease_id
  JOIN units u ON u.id = l.unit_id
  JOIN properties p ON p.id = u.property_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(x.amount), 0) AS paid FROM transactions x
     WHERE x.invoice_id = i.id AND x.status = 'success' AND x.paid_at < ${NEXT_DAY}
  ) pa ON TRUE`;

const INVOICE_EXISTED = `i.created_at < ${NEXT_DAY}
  AND NOT (i.status = 'void' AND (i.voided_at IS NULL OR i.voided_at < ${NEXT_DAY}))`;

const TXN_FROM = `
  FROM transactions x
  JOIN invoices i ON i.id = x.invoice_id
  JOIN leases l ON l.id = i.lease_id
  JOIN units u ON u.id = l.unit_id
  JOIN properties p ON p.id = u.property_id`;

const dashboardQuery = z.object({
  date: isoDate.optional(),
  property_id: uuid.optional(),
});

router.get('/dashboard/summary', async (req, res) => {
  const q = parse(dashboardQuery, req.query);
  const when = await resolveDate(q.date);

  // Each query gets its own parameter list (Postgres rejects unused parameters).
  const run = (usesDate, build) => {
    const params = usesDate ? [when.date] : [];
    let scope = propertyScope(req.user, params);
    if (q.property_id) {
      params.push(q.property_id);
      scope += ` AND p.id = $${params.length}`;
    }
    return query(build(scope), params);
  };

  const [totals, collected, spend, spendProps, byType, trend, ageing, deposits] = await Promise.all([
    run(true, (scope) => `
      SELECT COALESCE(sum(i.amount_due), 0) AS billed,
             COALESCE(sum(i.amount_due - pa.paid) FILTER (WHERE i.amount_due - pa.paid > 0 AND i.due_date >= $1::date), 0) AS pending,
             COALESCE(sum(i.amount_due - pa.paid) FILTER (WHERE i.amount_due - pa.paid > 0 AND i.due_date < $1::date), 0) AS overdue,
             (count(*) FILTER (WHERE i.amount_due - pa.paid <= 0))::int AS paid_count,
             count(*)::int AS invoice_count
        ${INVOICES_AS_OF}
       WHERE ${scope} AND i.billing_period = ${MONTH} AND ${INVOICE_EXISTED}`),
    run(true, (scope) => `
      SELECT COALESCE(sum(x.amount), 0) AS collected ${TXN_FROM}
       WHERE ${scope} AND x.status = 'success'
         AND date_trunc('month', x.paid_at)::date = ${MONTH} AND x.paid_at < ${NEXT_DAY}`),
    run(true, (scope) => `
      SELECT COALESCE(sum(ms.amount), 0) AS spent
        FROM maintenance_spend ms JOIN properties p ON p.id = ms.property_id
       WHERE ${scope} AND ms.month = ${MONTH} AND ms.updated_at < ${NEXT_DAY}`),
    run(true, (scope) => `
      SELECT p.id, p.name, COALESCE(ms.amount, 0) AS amount, ms.note
        FROM properties p LEFT JOIN maintenance_spend ms ON ms.property_id = p.id AND ms.month = ${MONTH}
       WHERE ${scope} ORDER BY p.name`),
    run(true, (scope) => `
      SELECT u.unit_type, count(*)::int AS total,
             (count(*) FILTER (WHERE occ.unit_id IS NOT NULL))::int AS occupied,
             min(u.monthly_rent) AS min_rent, max(u.monthly_rent) AS max_rent
        FROM units u
        JOIN properties p ON p.id = u.property_id
        LEFT JOIN LATERAL (
          SELECT l.unit_id FROM leases l
           WHERE l.unit_id = u.id AND l.status <> 'draft'
             AND l.start_date <= $1::date
             AND (l.terminated_on IS NULL OR l.terminated_on > $1::date)
             AND (l.end_date IS NULL OR l.end_date >= $1::date)
           LIMIT 1
        ) occ ON TRUE
       WHERE ${scope} AND u.created_at < ${NEXT_DAY}
       GROUP BY u.unit_type
       ORDER BY u.unit_type NULLS LAST`),
    run(true, (scope) => `
      WITH months AS (
        SELECT generate_series((${MONTH} - interval '5 months')::date, ${MONTH}, interval '1 month')::date AS m
      )
      SELECT to_char(r.m, 'YYYY-MM') AS month, r.collected, r.spent, (r.collected - r.spent) AS net
        FROM (
          SELECT months.m,
                 COALESCE((SELECT sum(x.amount) ${TXN_FROM}
                            WHERE ${scope} AND x.status = 'success'
                              AND date_trunc('month', x.paid_at)::date = months.m AND x.paid_at < ${NEXT_DAY}), 0) AS collected,
                 COALESCE((SELECT sum(ms.amount)
                             FROM maintenance_spend ms JOIN properties p ON p.id = ms.property_id
                            WHERE ${scope} AND ms.month = months.m AND ms.updated_at < ${NEXT_DAY}), 0) AS spent
            FROM months
        ) r ORDER BY 1`),
    run(true, (scope) => `
      SELECT COALESCE(sum(i.amount_due - pa.paid) FILTER (WHERE $1::date - i.due_date BETWEEN 1 AND 7), 0) AS d0_7,
             COALESCE(sum(i.amount_due - pa.paid) FILTER (WHERE $1::date - i.due_date BETWEEN 8 AND 30), 0) AS d8_30,
             COALESCE(sum(i.amount_due - pa.paid) FILTER (WHERE $1::date - i.due_date > 30), 0) AS d30_plus
        ${INVOICES_AS_OF}
       WHERE ${scope} AND ${INVOICE_EXISTED} AND i.amount_due - pa.paid > 0 AND i.due_date < $1::date`),
    when.isToday
      ? run(false, (scope) => `
          SELECT COALESCE(sum(l.deposit_amount) FILTER (WHERE l.deposit_status = 'held'), 0) AS held,
                 COALESCE(sum(l.deposit_amount) FILTER (WHERE l.deposit_status = 'pending'), 0) AS pending,
                 (count(*) FILTER (WHERE l.deposit_status = 'held'))::int AS held_count,
                 (count(*) FILTER (WHERE l.deposit_status = 'pending'))::int AS pending_count
            FROM leases l JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id
           WHERE ${scope} AND l.status = 'active' AND l.deposit_amount > 0`)
      : Promise.resolve({ rows: [null] }),
  ]);

  const { rows: net } = await query('SELECT ($1::numeric - $2::numeric) AS net', [collected.rows[0].collected, spend.rows[0].spent]);
  const t = totals.rows[0];
  const totalUnits = byType.rows.reduce((n, r) => n + r.total, 0);
  const occupied = byType.rows.reduce((n, r) => n + r.occupied, 0);

  res.json({
    date: when.date,
    is_today: when.isToday,
    earliest: when.earliest,
    today: when.today,
    month: when.date.slice(0, 7),
    collected: collected.rows[0].collected,
    maintenance_spent: spend.rows[0].spent,
    net_income: net[0].net,
    pending: t.pending,
    overdue: t.overdue,
    billed: t.billed,
    paid_count: t.paid_count,
    invoice_count: t.invoice_count,
    total_units: totalUnits,
    occupied_units: occupied,
    vacant_units: totalUnits - occupied,
    occupancy_pct: totalUnits > 0 ? Math.round((occupied / totalUnits) * 1000) / 10 : 0,
    by_type: byType.rows.map((r) => ({ ...r, vacant: r.total - r.occupied })),
    revenue_trend: trend.rows,
    arrears_ageing: ageing.rows[0],
    deposits: deposits.rows[0],
    maintenance_properties: spendProps.rows,
  });
});

/** Latest successful rent payments as of the chosen day, newest first (the "live updates" feed). */
router.get('/dashboard/live', async (req, res) => {
  const q = parse(dashboardQuery.extend({ limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
  const when = await resolveDate(q.date);

  const params = [when.date];
  let scope = propertyScope(req.user, params);
  if (q.property_id) {
    params.push(q.property_id);
    scope += ` AND p.id = $${params.length}`;
  }
  params.push(q.limit);

  const { rows } = await query(
    `SELECT x.id, x.amount, x.method, x.paid_at, u.unit_number, t.full_name AS tenant_name, p.name AS property_name,
            (i.amount_due - pa.paid) AS balance, to_char(i.billing_period, 'Mon YYYY') AS period
       FROM transactions x
       JOIN invoices i ON i.id = x.invoice_id
       JOIN leases l ON l.id = i.lease_id
       JOIN units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       JOIN tenants t ON t.id = l.tenant_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(y.amount), 0) AS paid FROM transactions y
          WHERE y.invoice_id = i.id AND y.status = 'success' AND y.paid_at <= x.paid_at
       ) pa ON TRUE
      WHERE ${scope} AND x.status = 'success' AND x.paid_at < ${NEXT_DAY}
      ORDER BY x.paid_at DESC
      LIMIT $${params.length}`,
    params
  );
  res.json(rows.map((r) => ({ ...r, fully_paid: Number(r.balance) <= 0 })));
});

/** Manually set the maintenance spend for a property and month; it is deducted from net income. */
router.put('/dashboard/maintenance-spend', manage, async (req, res) => {
  const b = parse(
    z.object({ property_id: uuid, month: month.optional(), amount: money, note: z.string().trim().max(300).optional() }),
    req.body
  );

  const params = [b.property_id];
  const scope = propertyScope(req.user, params);
  const owned = await query(`SELECT p.name, p.owner_id FROM properties p WHERE p.id = $1 AND ${scope}`, params);
  if (!owned.rows[0]) throw notFound('We could not find that property.');

  const { rows } = await query(
    `INSERT INTO maintenance_spend (property_id, month, amount, note, updated_by)
     VALUES ($1, COALESCE(to_date($2, 'YYYY-MM'), date_trunc('month', CURRENT_DATE)::date), $3, $4, $5)
     ON CONFLICT (property_id, month)
     DO UPDATE SET amount = EXCLUDED.amount, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING to_char(month, 'YYYY-MM') AS month, amount`,
    [b.property_id, b.month ?? null, b.amount, b.note ?? null, req.user.id]
  );

  await logActivity({
    category: 'finance', action: 'maintenance_spend_updated',
    message: `Maintenance spend for ${owned.rows[0].name} in ${rows[0].month} was set to ${kes(rows[0].amount)}.`,
    actorId: req.user.id, propertyId: b.property_id,
  });
  emit('finance_changed', {}, owned.rows[0].owner_id);
  res.json(rows[0]);
});

/** Record a cash/bank payment taken outside M-Pesa. */
router.post('/transactions/manual', manage, async (req, res) => {
  const b = parse(
    z.object({
      invoice_id: uuid,
      amount: positiveMoney,
      method: z.enum(['cash', 'bank_transfer', 'mpesa']),
      reference: z.string().trim().max(100).optional(),
    }),
    req.body
  );

  const params = [b.invoice_id];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(
    `SELECT i.status, (i.amount_due - i.amount_paid) AS balance
       FROM invoices i JOIN leases l ON l.id = i.lease_id JOIN units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id WHERE i.id = $1 AND ${scope}`,
    params
  );
  const inv = rows[0];
  if (!inv) throw notFound('We could not find that invoice.');
  if (!['pending', 'partial', 'overdue'].includes(inv.status)) throw badRequest('This rent is already settled.');
  if (Number(b.amount) > Number(inv.balance)) throw badRequest(`That is more than the balance of ${kes(inv.balance)}.`);

  const { txn } = await recordManual({ invoiceId: b.invoice_id, amount: b.amount, method: b.method, reference: b.reference, userId: req.user.id });
  res.status(201).json(txn);
});

/** Server-Sent Events: pushes payment/vacate/etc. events to open dashboards. */
router.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': connected\n\n');

  const remove = addClient(res, req.user);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    remove();
  });
});

export default router;
