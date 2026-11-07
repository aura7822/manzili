import { query } from '../db.js';

/**
 * Rent the landlord has set for a property + house type + floor.
 * A floor-specific price wins over the "all floors" price for that type. Returns null if none is set.
 */
export async function lookupRent(propertyId, unitType, floor, db = null) {
  const run = db ? db.query.bind(db) : query;
  const { rows } = await run(
    `SELECT monthly_rent FROM price_rules
      WHERE property_id = $1 AND unit_type = $2 AND (floor_number IS NULL OR floor_number = $3::int)
      ORDER BY (floor_number IS NULL) ASC
      LIMIT 1`,
    [propertyId, unitType, floor ?? 0]
  );
  return rows[0]?.monthly_rent ?? null;
}
