import { config } from '../config.js';
import { query, withTx } from '../db.js';
import { badRequest, conflict, notFound } from '../util/errors.js';
import { propertyScope } from '../util/sql.js';
import { kes } from '../util/format.js';
import { logActivity } from './activity.js';
import { emit } from './events.js';
import { generateInvoices } from './billing.js';
import { lookupRent } from './pricing.js';

/**
 * Add a tenant to a vacant house: creates the tenant, an open-ended lease, sets the house type,
 * marks the house occupied and issues this month's invoice. All or nothing.
 */
export async function onboardTenant(user, b) {
  const result = await withTx(async (db) => {
    const params = [b.unit_id];
    const scope = propertyScope(user, params);
    const { rows } = await db.query(
      `SELECT u.id, u.unit_number, u.floor_number, u.monthly_rent, p.id AS property_id, p.owner_id
         FROM units u JOIN properties p ON p.id = u.property_id
        WHERE u.id = $1 AND ${scope} FOR UPDATE OF u`,
      params
    );
    const unit = rows[0];
    if (!unit) throw notFound('We could not find that house.');

    const busy = await db.query(`SELECT 1 FROM leases WHERE unit_id = $1 AND status = 'active'`, [unit.id]);
    if (busy.rowCount) throw conflict(`House ${unit.unit_number} is already occupied. Vacate it first.`);

    const tenant = (
      await db.query(
        `INSERT INTO tenants (full_name, phone, email, national_id, preferred_channel)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, created_at`,
        [b.full_name, b.phone, b.email ?? null, b.national_id, b.preferred_channel]
      )
    ).rows[0];

    // Rent: what the landlord typed, else the price set for this property/type/floor, else the house's own rent.
    const rent = b.rent_amount ?? (await lookupRent(unit.property_id, b.unit_type, unit.floor_number, db)) ?? unit.monthly_rent;

    const lease = (
      await db.query(
        `INSERT INTO leases (unit_id, tenant_id, start_date, rent_amount, rent_due_day, deposit_amount, deposit_status, status)
         VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, 'active') RETURNING id`,
        [unit.id, tenant.id, b.start_date ?? null, rent, b.rent_due_day, b.deposit_amount, b.deposit_paid ? 'held' : 'pending']
      )
    ).rows[0];

    await db.query(`UPDATE units SET unit_type = $2, monthly_rent = $3, status = 'occupied' WHERE id = $1`, [
      unit.id, b.unit_type, rent,
    ]);
    await generateInvoices(null, { leaseId: lease.id, db });

    return { tenant, unit, leaseId: lease.id };
  });

  await logActivity({
    category: 'tenant', action: 'tenant_added',
    message: `${result.tenant.full_name} was added to house ${result.unit.unit_number} (${b.unit_type.replace('_', ' ')}). Deposit ${Number(b.deposit_amount) > 0 ? `${kes(b.deposit_amount)} ${b.deposit_paid ? 'paid' : 'pending'}` : 'none'}.`,
    actorId: user.id, propertyId: result.unit.property_id,
  });
  emit('tenants_changed', { unit_id: result.unit.id }, result.unit.owner_id);
  return result;
}

/**
 * Vacate a house: archive the tenant's details for 60 days, end the lease, void unpaid invoices,
 * erase the tenant's personal data and mark the house vacant. All or nothing.
 */
export async function vacateUnit(user, unitId) {
  const result = await withTx(async (db) => {
    const params = [unitId];
    const scope = propertyScope(user, params);
    const { rows } = await db.query(
      `SELECT l.id AS lease_id, l.start_date, l.rent_amount, l.tenant_id, l.deposit_amount, l.deposit_status,
              u.id AS unit_id, u.unit_number, u.unit_type,
              p.id AS property_id, p.name AS property_name, p.owner_id,
              t.full_name, t.phone, t.email, t.national_id
         FROM units u
         JOIN properties p ON p.id = u.property_id
         LEFT JOIN leases l ON l.unit_id = u.id AND l.status = 'active'
         LEFT JOIN tenants t ON t.id = l.tenant_id
        WHERE u.id = $1 AND ${scope}
        FOR UPDATE OF u`,
      params
    );
    const row = rows[0];
    if (!row) throw notFound('We could not find that house.');
    if (!row.lease_id) throw badRequest(`House ${row.unit_number} is already vacant.`);

    const totals = (
      await db.query(
        `SELECT COALESCE(sum(amount_paid), 0) AS total_paid,
                COALESCE(sum(amount_due - amount_paid) FILTER (WHERE status <> 'void'), 0) AS outstanding
           FROM invoices WHERE lease_id = $1`,
        [row.lease_id]
      )
    ).rows[0];

    const archive = (
      await db.query(
        `INSERT INTO archives (property_id, property_name, unit_number, unit_type, tenant_name, phone, email, national_id,
                               lease_start, rent_amount, total_paid, outstanding_balance, purge_at, vacated_by,
                               deposit_amount, deposit_paid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + make_interval(days => $13), $14, $15, $16)
         RETURNING id, purge_at`,
        [row.property_id, row.property_name, row.unit_number, row.unit_type, row.full_name, row.phone, row.email,
         row.national_id, row.start_date, row.rent_amount, totals.total_paid, totals.outstanding,
         config.retention.archiveDays, user.id, row.deposit_amount ?? 0, row.deposit_status === 'held']
      )
    ).rows[0];

    await db.query(`UPDATE leases SET status = 'terminated', terminated_on = CURRENT_DATE WHERE id = $1`, [row.lease_id]);
    await db.query(`UPDATE invoices SET status = 'void', voided_at = now() WHERE lease_id = $1 AND status IN ('pending', 'partial', 'overdue')`, [row.lease_id]);

    // Erase personal details unless the same person still has another active lease.
    const other = await db.query(`SELECT 1 FROM leases WHERE tenant_id = $1 AND status = 'active'`, [row.tenant_id]);
    if (!other.rowCount) {
      await db.query(
        `UPDATE tenants
            SET full_name = 'Former tenant', phone = 'del-' || substr(id::text, 1, 12),
                national_id = 'del-' || substr(id::text, 1, 12), email = NULL,
                emergency_contact = NULL, emergency_phone = NULL
          WHERE id = $1`,
        [row.tenant_id]
      );
      await db.query(`DELETE FROM notifications WHERE tenant_id = $1`, [row.tenant_id]);
    }

    await db.query(`UPDATE units SET status = 'vacant' WHERE id = $1`, [row.unit_id]);
    return { ...row, archive, outstanding: totals.outstanding };
  });

  await logActivity({
    category: 'tenant', action: 'tenant_vacated',
    message: `House ${result.unit_number} was vacated. ${result.full_name}'s details were archived until ${new Date(result.archive.purge_at).toLocaleDateString('en-KE')}.${
      Number(result.outstanding) > 0 ? ` Unpaid rent of ${kes(result.outstanding)} was recorded in the archive.` : ''
    }`,
    actorId: user.id, propertyId: result.property_id,
  });
  emit('unit_vacated', { unit_id: result.unit_id, unit_number: result.unit_number }, result.owner_id);
  return result;
}

/** Delete archived tenants past their 60-day window and very old log entries. */
export async function purgeExpired() {
  const archives = await query(`DELETE FROM archives WHERE purge_at <= now()`);
  const logs = await query(`DELETE FROM activity_log WHERE created_at < now() - make_interval(days => $1)`, [config.retention.logDays]);
  if (archives.rowCount > 0) {
    await logActivity({
      category: 'system', action: 'archives_purged',
      message: `${archives.rowCount} archived tenant record(s) were permanently deleted after ${config.retention.archiveDays} days.`,
    });
  }
  return { archives: archives.rowCount, logs: logs.rowCount };
}
