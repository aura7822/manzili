import { query } from '../db.js';
import { badRequest, notFound } from './errors.js';

/**
 * Build a parameterised UPDATE from an already-validated object.
 * Column names come from our own zod schemas, never from raw user input.
 */
export function buildUpdate(table, data, id) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (keys.length === 0) throw badRequest('Nothing to update');
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  const params = [...keys.map((k) => data[k]), id];
  return { text: `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params };
}

/**
 * Returns a SQL condition limiting rows to properties the user may see.
 * Landlords only see their own properties; admins and caretakers see all.
 */
export function propertyScope(user, params, alias = 'p') {
  if (user.role !== 'landlord') return 'TRUE';
  params.push(user.id);
  return `${alias}.owner_id = $${params.length}`;
}

/** Throws 404 unless the unit exists and the user may see its property. */
export async function assertUnitAccess(user, unitId) {
  const params = [unitId];
  const scope = propertyScope(user, params);
  const { rows } = await query(
    `SELECT u.id FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = $1 AND ${scope}`,
    params
  );
  if (!rows[0]) throw notFound('We could not find that house.');
}

/** Keep a unit's status in sync with its leases (unless it is under maintenance). */
export async function syncUnitStatus(client, unitId) {
  await client.query(
    `UPDATE units u
        SET status = CASE
              WHEN EXISTS (SELECT 1 FROM leases l WHERE l.unit_id = u.id AND l.status = 'active')
                THEN 'occupied'::unit_status
              ELSE 'vacant'::unit_status
            END
      WHERE u.id = $1 AND u.status <> 'maintenance'`,
    [unitId]
  );
}
