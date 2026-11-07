import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { parse } from '../util/validate.js';

const router = Router();

export const LOG_CATEGORIES = ['mpesa', 'payment', 'tenant', 'unit', 'message', 'broadcast', 'finance', 'auth', 'system'];

router.get('/logs', requireRole('admin', 'landlord'), async (req, res) => {
  const q = parse(
    z.object({
      category: z.enum(LOG_CATEGORIES).optional(),
      q: z.string().trim().max(100).optional(),
      before: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    req.query
  );

  const params = [];
  const where = [];
  if (req.user.role === 'landlord') {
    // Landlords see activity for their own properties and their own actions.
    params.push(req.user.id);
    where.push(`(a.actor_id = $${params.length} OR a.property_id IN (SELECT id FROM properties WHERE owner_id = $${params.length}))`);
  }
  if (q.category) { params.push(q.category); where.push(`a.category = $${params.length}`); }
  if (q.q) { params.push(`%${q.q}%`); where.push(`a.message ILIKE $${params.length}`); }
  if (q.before) { params.push(q.before); where.push(`a.id < $${params.length}`); }
  params.push(q.limit + 1);

  const { rows } = await query(
    `SELECT a.id, a.category, a.action, a.message, a.meta, a.created_at, u.full_name AS actor_name
       FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.id DESC LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > q.limit;
  const items = hasMore ? rows.slice(0, q.limit) : rows;
  res.json({ items, next_before: hasMore ? items[items.length - 1].id : null });
});

export default router;
