import { Router } from 'express';
import { z } from 'zod';
import { query, withTx } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { logActivity } from '../services/activity.js';
import { lookupRent } from '../services/pricing.js';
import { badRequest, notFound } from '../util/errors.js';
import { HOUSE_TYPES } from '../util/houseTypes.js';
import { propertyScope } from '../util/sql.js';
import { money, parse, uuid } from '../util/validate.js';

const router = Router();

/** Every price the user has set, for the properties they can see. */
router.get('/pricing', async (req, res) => {
  const params = [];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(
    `SELECT r.id, r.property_id, r.unit_type, r.floor_number, r.monthly_rent
       FROM price_rules r JOIN properties p ON p.id = r.property_id
      WHERE ${scope}
      ORDER BY p.name, r.unit_type, r.floor_number NULLS FIRST`,
    params
  );
  res.json(rows);
});

/** The rent that applies to a property + house type + floor (used to auto-fill forms). */
router.get('/pricing/lookup', async (req, res) => {
  const q = parse(
    z.object({ property_id: uuid, unit_type: z.enum(HOUSE_TYPES), floor: z.coerce.number().int().default(0) }),
    req.query
  );
  const params = [q.property_id];
  const scope = propertyScope(req.user, params);
  const owned = await query(`SELECT 1 FROM properties p WHERE p.id = $1 AND ${scope}`, params);
  if (!owned.rowCount) throw notFound('We could not find that property.');
  res.json({ monthly_rent: await lookupRent(q.property_id, q.unit_type, q.floor) });
});

/** Replace a property's price list. Optionally re-price its vacant houses to match. */
router.put('/properties/:id/pricing', requireRole('admin', 'landlord'), async (req, res) => {
  const b = parse(
    z.object({
      rules: z
        .array(
          z.object({
            unit_type: z.enum(HOUSE_TYPES),
            floor_number: z.number().int().min(-5).max(150).nullable().default(null),
            monthly_rent: money,
          })
        )
        .max(100),
      apply_to_vacant: z.boolean().default(false),
    }),
    req.body
  );

  const seen = new Set();
  for (const r of b.rules) {
    const key = `${r.unit_type}|${r.floor_number ?? 'all'}`;
    if (seen.has(key)) throw badRequest('Each house type can only have one price per floor. Please remove the duplicate.');
    seen.add(key);
  }

  const params = [req.params.id];
  const scope = propertyScope(req.user, params);
  const prop = (await query(`SELECT p.id, p.name FROM properties p WHERE p.id = $1 AND ${scope}`, params)).rows[0];
  if (!prop) throw notFound('We could not find that property.');

  const updatedUnits = await withTx(async (db) => {
    await db.query('DELETE FROM price_rules WHERE property_id = $1', [prop.id]);
    for (const r of b.rules) {
      await db.query(
        'INSERT INTO price_rules (property_id, unit_type, floor_number, monthly_rent) VALUES ($1, $2, $3, $4)',
        [prop.id, r.unit_type, r.floor_number, r.monthly_rent]
      );
    }
    if (!b.apply_to_vacant) return 0;

    const result = await db.query(
      `UPDATE units u SET monthly_rent = r.monthly_rent
         FROM (
           SELECT DISTINCT ON (u2.id) u2.id, pr.monthly_rent
             FROM units u2
             JOIN price_rules pr ON pr.property_id = u2.property_id AND pr.unit_type = u2.unit_type
                                AND (pr.floor_number IS NULL OR pr.floor_number = u2.floor_number)
            WHERE u2.property_id = $1 AND u2.status = 'vacant'
            ORDER BY u2.id, (pr.floor_number IS NULL)
         ) r
        WHERE u.id = r.id`,
      [prop.id]
    );
    return result.rowCount;
  });

  await logActivity({
    category: 'finance', action: 'pricing_updated',
    message: `Prices for ${prop.name} were updated (${b.rules.length} price${b.rules.length === 1 ? '' : 's'})${
      b.apply_to_vacant ? `; ${updatedUnits} vacant house${updatedUnits === 1 ? '' : 's'} re-priced` : ''
    }.`,
    actorId: req.user.id, propertyId: prop.id,
  });
  res.json({ rules: b.rules.length, updated_units: updatedUnits });
});

export default router;
