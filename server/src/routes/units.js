import QRCode from 'qrcode';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { vacateUnit } from '../services/tenancy.js';
import { badRequest, notFound } from '../util/errors.js';
import { HOUSE_TYPES } from '../util/houseTypes.js';
import { lookupRent } from '../services/pricing.js';
import { assertUnitAccess, buildUpdate, propertyScope } from '../util/sql.js';
import { money, parse, uuid } from '../util/validate.js';

const router = Router();
const manage = requireRole('admin', 'landlord');

const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'property';

/* ---------- properties ---------- */
router.get('/properties', async (req, res) => {
  const params = [];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(
    `SELECT p.*, (SELECT count(*) FROM units u WHERE u.property_id = p.id)::int AS unit_count
       FROM properties p WHERE ${scope} ORDER BY p.name`,
    params
  );
  res.json(rows);
});

router.post('/properties', manage, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(150),
      address: z.string().trim().min(1),
      city: z.string().trim().max(100).optional(),
      total_floors: z.number().int().positive().optional(),
    }),
    req.body
  );
  const { rows } = await query(
    `INSERT INTO properties (owner_id, name, slug, address, city, total_floors)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user.id, body.name, slugify(body.name), body.address, body.city ?? null, body.total_floors ?? null]
  );
  await logActivity({ category: 'unit', action: 'property_added', message: `Property "${body.name}" was added.`, actorId: req.user.id, propertyId: rows[0].id });
  res.status(201).json(rows[0]);
});

router.patch('/properties/:id', manage, async (req, res) => {
  const params = [req.params.id];
  const scope = propertyScope(req.user, params);
  const exists = await query(`SELECT id FROM properties WHERE id = $1 AND ${scope}`, params);
  if (!exists.rowCount) throw notFound('We could not find that property.');

  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(150).optional(),
      address: z.string().trim().min(1).optional(),
      city: z.string().trim().max(100).nullable().optional(),
      total_floors: z.number().int().positive().nullable().optional(),
    }).partial(),
    req.body
  );
  if (Object.keys(body).length === 0) throw badRequest('Nothing to update');
  if (body.name) body.slug = slugify(body.name);

  const { text, params: p2 } = buildUpdate('properties', body, req.params.id);
  const { rows } = await query(text, p2);
  res.json(rows[0]);
});

router.delete('/properties/:id', manage, async (req, res) => {
  const params = [req.params.id];
  const scope = propertyScope(req.user, params);
  const exists = await query(`SELECT p.id, p.name FROM properties p WHERE p.id = $1 AND ${scope}`, params);
  if (!exists.rowCount) throw notFound('We could not find that property.');

  const hasActiveLease = await query(
    `SELECT 1 FROM units u
      WHERE u.property_id = $1 AND EXISTS (SELECT 1 FROM leases l WHERE l.unit_id = u.id AND l.status = 'active')
      LIMIT 1`,
    [req.params.id]
  );
  if (hasActiveLease.rowCount) throw badRequest('This property still has occupied houses. Vacate them before deleting the property.');

  const hasLeaseHistory = await query(
    `SELECT 1 FROM leases l JOIN units u ON u.id = l.unit_id WHERE u.property_id = $1 LIMIT 1`,
    [req.params.id]
  );
  if (hasLeaseHistory.rowCount) throw badRequest('This property has lease history. Please clear its tenant records before deleting it.');

  const { rows } = await query(`DELETE FROM properties WHERE id = $1 AND ${scope} RETURNING *`, params);
  res.json({ deleted: true, id: rows[0].id, name: rows[0].name });
});

router.get('/properties/:id/qr', async (req, res) => {
  const q = parse(
    z.object({
      unit_type: z.enum(HOUSE_TYPES).optional(),
      floor_number: z.coerce.number().int().min(-5).max(150).optional(),
      amount: z.coerce.number().int().min(1).max(1000000).optional(),
    }).partial(),
    req.query
  );
  const params = [req.params.id];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(`SELECT p.slug FROM properties p WHERE p.id = $1 AND ${scope}`, params);
  if (!rows[0]) throw notFound('We could not find that property.');

  const search = new URLSearchParams();
  if (q.unit_type) search.set('unit_type', q.unit_type);
  if (q.floor_number !== undefined) search.set('floor', String(q.floor_number));
  if (q.amount !== undefined) search.set('amount', String(q.amount));

  const url = `${config.publicUrl}/p/${rows[0].slug}${search.size ? `?${search.toString()}` : ''}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 2, width: 320 });
  res.json({ url, svg });
});

/* ---------- units ---------- */
const unitBody = z.object({
  property_id: uuid,
  unit_number: z.string().trim().min(1).max(20),
  floor_number: z.number().int().default(0),
  unit_type: z.enum(HOUSE_TYPES),
  monthly_rent: money.optional(), // when omitted, the price you set for this property/type/floor is used
});

router.get('/units/overview', async (req, res) => {
  const q = parse(
    z.object({
      property_id: uuid.optional(),
      status: z.enum(['vacant', 'occupied', 'maintenance']).optional(),
      q: z.string().trim().max(100).optional(),
    }),
    req.query
  );

  const params = [];
  const where = [propertyScope(req.user, params)];
  if (q.property_id) { params.push(q.property_id); where.push(`p.id = $${params.length}`); }
  if (q.status) { params.push(q.status); where.push(`u.status = $${params.length}`); }
  if (q.q) {
    params.push(`%${q.q}%`);
    const i = params.length;
    where.push(`(u.unit_number ILIKE $${i} OR t.full_name ILIKE $${i} OR t.phone ILIKE $${i} OR t.national_id ILIKE $${i})`);
  }

  const { rows } = await query(
    `SELECT u.id, u.unit_number, u.floor_number, u.unit_type, u.monthly_rent, u.status,
            p.id AS property_id, p.name AS property_name,
            l.id AS lease_id, l.start_date AS lease_start, l.deposit_amount, l.deposit_status,
            t.id AS tenant_id, t.full_name AS tenant_name, t.phone AS tenant_phone, t.national_id,
            EXTRACT(YEAR FROM age(CURRENT_DATE, l.start_date))::int AS tenure_years,
            EXTRACT(MONTH FROM age(CURRENT_DATE, l.start_date))::int AS tenure_months
       FROM units u
       JOIN properties p ON p.id = u.property_id
       LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
       LEFT JOIN tenants t ON t.id = l.tenant_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.name, u.floor_number, u.unit_number`,
    params
  );
  res.json(rows);
});

router.post('/units', manage, async (req, res) => {
  const b = parse(unitBody, req.body);
  const params = [b.property_id];
  const scope = propertyScope(req.user, params);
  const owned = await query(`SELECT 1 FROM properties p WHERE p.id = $1 AND ${scope}`, params);
  if (!owned.rowCount) throw notFound('We could not find that property.');

  const rent = b.monthly_rent ?? (await lookupRent(b.property_id, b.unit_type, b.floor_number));
  if (rent === null || rent === undefined) {
    throw badRequest('Please enter the monthly rent, or set a price for this house type under Prices on the Control Panel.');
  }

  const { rows } = await query(
    `INSERT INTO units (property_id, unit_number, floor_number, unit_type, monthly_rent)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [b.property_id, b.unit_number, b.floor_number, b.unit_type, rent]
  );
  await logActivity({ category: 'unit', action: 'unit_added', message: `House ${b.unit_number} was added (${b.unit_type.replace('_', ' ')}, floor ${b.floor_number}).`, actorId: req.user.id, propertyId: b.property_id });
  res.status(201).json(rows[0]);
});

router.patch('/units/:id', manage, async (req, res) => {
  await assertUnitAccess(req.user, req.params.id);
  const b = parse(unitBody.omit({ property_id: true }).partial(), req.body);
  const { text, params } = buildUpdate('units', b, req.params.id);
  const { rows } = await query(text, params);
  res.json(rows[0]);
});

router.delete('/units/:id', manage, async (req, res) => {
  await assertUnitAccess(req.user, req.params.id);

  const hasLease = await query(`SELECT 1 FROM leases WHERE unit_id = $1 LIMIT 1`, [req.params.id]);
  if (hasLease.rowCount) throw badRequest('This house has lease history and cannot be deleted. Vacate or remove the tenant record before deleting it.');

  const { rows } = await query(`DELETE FROM units WHERE id = $1 RETURNING *`, [req.params.id]);
  res.json({ deleted: true, id: rows[0].id, unit_number: rows[0].unit_number });
});

/** Mark a house vacant, archive the tenant for 60 days and erase their details. */
router.post('/units/:id/vacate', manage, async (req, res) => {
  const r = await vacateUnit(req.user, req.params.id);
  res.json({
    unit_number: r.unit_number,
    tenant_name: r.full_name,
    purge_at: r.archive.purge_at,
    outstanding_balance: r.outstanding,
  });
});

export default router;
