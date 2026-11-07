import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { notifyTenant } from '../services/notifications.js';
import { badRequest } from '../util/errors.js';
import { firstName } from '../util/format.js';
import { HOUSE_TYPES } from '../util/houseTypes.js';
import { parse, uuid } from '../util/validate.js';
import { findTenants } from './tenants.js';

const MAX_RECIPIENTS = 500;

const router = Router();
router.use('/broadcast', requireRole('admin', 'landlord'));

const filters = z.object({
  unit_type: z.enum(HOUSE_TYPES).optional(),
  floor: z.number().int().optional(),
  status: z.enum(['paid', 'pending', 'partial', 'overdue', 'unpaid']).optional(),
  deposit: z.enum(['paid', 'pending']).optional(),
  property_id: uuid.optional(),
});

// Optionally narrow to specific tenants the landlord ticked (they must also match the filters).
const target = z.object({ filters: filters.default({}), tenant_ids: z.array(uuid).max(MAX_RECIPIENTS).optional() });

const recipientsFor = (user, { filters: f, tenant_ids: ids }) => findTenants(user, { ...f, ids });

router.post('/broadcast/preview', async (req, res) => {
  const target_ = parse(target, req.body ?? {});
  const list = await recipientsFor(req.user, target_);
  res.json({
    count: list.length,
    sample: list.slice(0, 5).map((t) => ({ name: t.full_name, house: t.unit_number })),
    recipients: list.slice(0, MAX_RECIPIENTS).map((t) => ({
      id: t.id, name: t.full_name, house: t.unit_number, unit_type: t.unit_type,
      rent_status: t.rent_status, deposit_status: t.deposit_status, deposit_amount: t.deposit_amount,
    })),
  });
});

router.post('/broadcast/send', async (req, res) => {
  const { message, ...target_ } = parse(target.extend({ message: z.string().trim().min(1).max(600) }), req.body);
  const f = target_.filters;

  const list = await recipientsFor(req.user, target_);
  if (list.length === 0) throw badRequest('No tenants match those filters, so nothing was sent.');
  if (list.length > MAX_RECIPIENTS) throw badRequest(`That would reach ${list.length} tenants. Please narrow the filters (limit ${MAX_RECIPIENTS}).`);

  const failures = [];
  let sent = 0;

  // Small batches keep the SMS provider happy and finish quickly.
  for (let i = 0; i < list.length; i += 5) {
    await Promise.all(
      list.slice(i, i + 5).map(async (t) => {
        const text = message.replaceAll('{name}', firstName(t.full_name)).replaceAll('{house}', t.unit_number);
        const r = await notifyTenant(t, 'broadcast', text, { log: false });
        if (r.delivered) sent++;
        else failures.push({ house: t.unit_number, tenant: t.full_name, reason: r.error });
      })
    );
  }

  await logActivity({
    category: 'broadcast', action: 'broadcast_sent',
    message: `Broadcast sent to ${sent} of ${list.length} tenant(s)${failures.length ? `, ${failures.length} failed` : ''}: "${message.slice(0, 120)}${message.length > 120 ? '...' : ''}"`,
    meta: { filters: f, picked: Boolean(target_.tenant_ids), total: list.length, sent, failed: failures.length },
    actorId: req.user.id,
  });

  res.json({ total: list.length, sent, failed: failures.length, failures: failures.slice(0, 10) });
});

export default router;
