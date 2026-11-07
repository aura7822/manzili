import { Router } from 'express';
import { z } from 'zod';
import { query, withTx } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { sendInvoiceReminder } from '../services/notifications.js';
import { onboardTenant } from '../services/tenancy.js';
import { badRequest, notFound } from '../util/errors.js';
import { HOUSE_TYPES } from '../util/houseTypes.js';
import { isValidPhone, normalizePhone } from '../util/phone.js';
import { buildUpdate, propertyScope } from '../util/sql.js';
import { isoDate, money, parse, uuid } from '../util/validate.js';

const router = Router();
const manage = requireRole('admin', 'landlord');

/**
 * Active tenants with their house, current rent status and deposit.
 * rent_status is worked out live (an unpaid invoice past its due date is "overdue" immediately).
 * Filters: q, status (paid|pending|partial|overdue|unpaid), deposit (paid|pending), unit_type,
 * floor, property_id, ids (specific tenants).
 */
export async function findTenants(user, { q, status, deposit, unit_type, floor, property_id, ids } = {}) {
  const params = [];
  const where = [propertyScope(user, params)];
  if (property_id) { params.push(property_id); where.push(`p.id = $${params.length}`); }
  if (unit_type) { params.push(unit_type); where.push(`u.unit_type = $${params.length}`); }
  if (floor !== undefined && floor !== null) { params.push(floor); where.push(`u.floor_number = $${params.length}`); }
  if (deposit === 'paid') where.push(`l.deposit_status = 'held'`);
  else if (deposit === 'pending') where.push(`l.deposit_status = 'pending' AND l.deposit_amount > 0`); // no deposit owed = not pending
  if (ids) { params.push(ids); where.push(`t.id = ANY($${params.length}::uuid[])`); }
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where.push(`(t.full_name ILIKE $${i} OR t.phone ILIKE $${i} OR t.national_id ILIKE $${i} OR u.unit_number ILIKE $${i})`);
  }

  let outer = 'TRUE';
  if (status === 'unpaid') outer = `r.rent_status IN ('pending', 'partial', 'overdue')`;
  else if (status) { params.push(status); outer = `r.rent_status = $${params.length}`; }

  const { rows } = await query(
    `SELECT * FROM (
       SELECT t.id, t.full_name, t.phone, t.email, t.national_id, t.preferred_channel, t.created_at,
              l.id AS lease_id, l.start_date, l.rent_amount, l.deposit_amount, l.deposit_status,
              u.id AS unit_id, u.unit_number, u.unit_type, u.floor_number,
              p.id AS property_id, p.name AS property_name,
              inv.id AS invoice_id, inv.due_date, inv.balance,
              CASE WHEN inv.id IS NULL THEN 'none'
                   WHEN inv.status IN ('pending', 'partial') AND inv.due_date < CURRENT_DATE THEN 'overdue'
                   ELSE inv.status::text END AS rent_status
         FROM leases l
         JOIN tenants t ON t.id = l.tenant_id
         JOIN units u ON u.id = l.unit_id
         JOIN properties p ON p.id = u.property_id
         LEFT JOIN LATERAL (
           SELECT i.id, i.status, i.due_date, (i.amount_due - i.amount_paid) AS balance
             FROM invoices i
            WHERE i.lease_id = l.id AND i.status <> 'void'
            ORDER BY (i.status IN ('pending', 'partial', 'overdue')) DESC,
                     CASE WHEN i.status IN ('pending', 'partial', 'overdue') THEN i.due_date END ASC,
                     i.due_date DESC
            LIMIT 1
         ) inv ON TRUE
        WHERE l.status = 'active' AND ${where.join(' AND ')}
     ) r
     WHERE ${outer}
     ORDER BY r.created_at DESC
     LIMIT 1000`,
    params
  );
  return rows;
}

router.get('/tenants', async (req, res) => {
  const q = parse(
    z.object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(['paid', 'pending', 'partial', 'overdue', 'unpaid']).optional(),
    }),
    req.query
  );
  res.json(await findTenants(req.user, q));
});

const tenantFields = z.object({
  full_name: z.string().trim().min(1).max(150),
  phone: z.string().trim().min(1),
  email: z.string().trim().email().max(255).nullable().optional(),
  national_id: z.string().trim().min(3).max(30),
  preferred_channel: z.enum(['sms', 'email', 'whatsapp']).default('sms'),
});

function cleanPhone(b) {
  if (b.phone !== undefined) {
    b.phone = normalizePhone(b.phone);
    if (!isValidPhone(b.phone)) throw badRequest('That phone number looks too short or too long. Please check it and try again.');
  }
  return b;
}

const needsEmail = (channel, email) => {
  if (channel === 'email' && !email) throw badRequest('Please add an email address before choosing email reminders.');
};

/** Add a tenant to a vacant house (sets the house type, starts rent billing, records the deposit). */
router.post('/tenants', manage, async (req, res) => {
  const b = cleanPhone(
    parse(
      tenantFields.extend({
        unit_id: uuid,
        unit_type: z.enum(HOUSE_TYPES),
        rent_amount: money.optional(), // blank = use the price set for this property/type/floor
        rent_due_day: z.number().int().min(1).max(28).default(5),
        start_date: isoDate.optional(),
        deposit_amount: money.default('0'),
        deposit_paid: z.boolean().default(false),
      }),
      req.body
    )
  );
  needsEmail(b.preferred_channel, b.email);
  const { tenant, unit } = await onboardTenant(req.user, b);
  res.status(201).json({ id: tenant.id, full_name: tenant.full_name, unit_number: unit.unit_number });
});

router.patch('/tenants/:id', manage, async (req, res) => {
  const body = parse(
    tenantFields.partial().extend({ deposit_amount: money.optional(), deposit_paid: z.boolean().optional() }),
    req.body
  );
  const { deposit_amount, deposit_paid, ...personal } = cleanPhone(body);

  const params = [req.params.id];
  const scope = propertyScope(req.user, params);
  const found = (
    await query(
      `SELECT t.id, t.email, t.preferred_channel, l.id AS lease_id
         FROM tenants t JOIN leases l ON l.tenant_id = t.id AND l.status = 'active'
         JOIN units u ON u.id = l.unit_id JOIN properties p ON p.id = u.property_id
        WHERE t.id = $1 AND ${scope}`,
      params
    )
  ).rows[0];
  if (!found) throw notFound('We could not find that tenant.');

  needsEmail(personal.preferred_channel ?? found.preferred_channel, personal.email !== undefined ? personal.email : found.email);

  const updated = await withTx(async (db) => {
    let row = { id: found.id };
    if (Object.keys(personal).length) {
      const { text, params: p2 } = buildUpdate('tenants', personal, found.id);
      row = (await db.query(text, p2)).rows[0];
    }
    if (deposit_amount !== undefined || deposit_paid !== undefined) {
      await db.query(
        `UPDATE leases
            SET deposit_amount = COALESCE($2::numeric, deposit_amount),
                deposit_status = CASE WHEN $3::boolean IS NULL THEN deposit_status
                                      WHEN $3::boolean THEN 'held'::deposit_status
                                      ELSE 'pending'::deposit_status END
          WHERE id = $1`,
        [found.lease_id, deposit_amount ?? null, deposit_paid ?? null]
      );
    }
    return row;
  });

  await logActivity({ category: 'tenant', action: 'tenant_updated', message: `Details for ${updated.full_name ?? 'a tenant'} were updated.`, actorId: req.user.id });
  res.json({ id: found.id });
});

/** Send a rent reminder. Only possible while rent is unpaid. */
router.post('/tenants/:id/remind', manage, async (req, res) => {
  const [t] = await findTenants(req.user, { ids: [req.params.id] });
  if (!t) throw notFound('We could not find that tenant.');
  if (!t.invoice_id || t.rent_status === 'paid' || t.rent_status === 'none') {
    throw badRequest(`${t.full_name} has no unpaid rent, so there is nothing to remind about.`);
  }

  const result = await sendInvoiceReminder(t.invoice_id, t.rent_status === 'overdue' ? 'overdue' : 'rent');
  res.json({
    delivered: result.delivered,
    message: result.delivered
      ? `Reminder sent to ${t.full_name}.`
      : `Reminder saved, but it could not be delivered: ${result.error}`,
  });
});

export default router;
