import { Router } from 'express';
import { query } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { purgeExpired } from '../services/tenancy.js';
import { propertyScope } from '../util/sql.js';

const router = Router();

router.get('/archives', requireRole('admin', 'landlord'), async (req, res) => {
  await purgeExpired(); // expired records disappear even if the nightly job has not run yet

  const params = [];
  const scope = propertyScope(req.user, params);
  const { rows } = await query(
    `SELECT a.id, a.property_name, a.unit_number, a.unit_type, a.tenant_name, a.phone, a.email, a.national_id,
            a.lease_start, a.rent_amount, a.total_paid, a.outstanding_balance, a.deposit_amount, a.deposit_paid, a.vacated_at, a.purge_at,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM (a.purge_at - now())) / 86400))::int AS days_left
       FROM archives a JOIN properties p ON p.id = a.property_id
      WHERE ${scope}
      ORDER BY a.vacated_at DESC
      LIMIT 500`,
    params
  );
  res.json(rows);
});

export default router;
