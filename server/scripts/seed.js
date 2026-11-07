import { config } from '../src/config.js';
import { ensureDefaultAdmin, pool, query } from '../src/db.js';
import { generateInvoices } from '../src/services/billing.js';

const demo = process.argv.includes('--demo');

try {
  const admin = await ensureDefaultAdmin();
  const adminId = admin.id;
  console.log(`Admin ready: ${process.env.ADMIN_EMAIL || 'admin@manzili.property'}`);

  if (demo) {
    const prop = await query(
      `INSERT INTO properties (owner_id, name, slug, address, city, total_floors)
       VALUES ($1, 'Sunrise Apartments', 'sunrise-apartments', 'Kenyatta Road', 'Thika', 3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [adminId]
    );
    const propertyId = prop.rows[0].id;

    const unitIds = [];
    for (const [num, floor, rent] of [['A1', 1, 15000], ['A2', 1, 8000], ['B1', 2, 15000], ['B2', 2, 8000]]) {
      const u = await query(
        `INSERT INTO units (property_id, unit_number, floor_number, monthly_rent)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (property_id, unit_number) DO UPDATE SET monthly_rent = EXCLUDED.monthly_rent RETURNING id`,
        [propertyId, num, floor, rent]
      );
      unitIds.push(u.rows[0].id);
    }

    const tenants = [
      ['Jane Mwangi', '254712000001', '30000001', 'single', 15000],
      ['Peter Otieno', '254712000002', '30000002', 'bedsitter', 8000],
    ];
    for (const [i, [name, phone, nid, type, rent]] of tenants.entries()) {
      const exists = await query(`SELECT 1 FROM leases WHERE unit_id = $1 AND status = 'active'`, [unitIds[i]]);
      if (exists.rowCount) continue;
      const t = await query(
        `INSERT INTO tenants (full_name, phone, national_id) VALUES ($1, $2, $3)
         ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
        [name, phone, nid]
      );
      await query(
        `INSERT INTO leases (unit_id, tenant_id, start_date, rent_amount, status)
         VALUES ($1, $2, date_trunc('month', CURRENT_DATE)::date - 60, $3, 'active')`,
        [unitIds[i], t.rows[0].id, rent]
      );
      await query(`UPDATE units SET status = 'occupied', unit_type = $2 WHERE id = $1`, [unitIds[i], type]);
    }
    console.log(`Demo data ready. Invoices created: ${await generateInvoices()}`);
    console.log(`Tenant payment page: ${config.publicUrl}/p/sunrise-apartments`);
  }
} finally {
  await pool.end();
}
