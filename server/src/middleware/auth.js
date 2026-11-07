import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { forbidden, unauthorized } from '../util/errors.js';

export function signStaffToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, typ: 'staff' }, config.jwtSecret, { expiresIn: '8h' });
}

/** Short-lived token issued to a tenant after unit + phone verification on the QR page. */
export function signPayToken(leaseId) {
  return jwt.sign({ lease: leaseId, typ: 'pay' }, config.jwtSecret, { expiresIn: '15m' });
}

function readBearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function verify(token, type) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload.typ === type ? payload : null;
  } catch {
    return null;
  }
}

export async function requireAuth(req, _res, next) {
  const payload = verify(readBearer(req), 'staff');
  if (!payload) throw unauthorized();

  const { rows } = await query(
    'SELECT id, email, full_name, role FROM users WHERE id = $1 AND is_active = TRUE',
    [payload.sub]
  );
  if (!rows[0]) throw unauthorized();

  req.user = rows[0];
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) throw forbidden();
  next();
};

/** Reads X-Pay-Token and returns the lease id it was issued for. */
export function requirePayToken(req, _res, next) {
  const payload = verify(String(req.headers['x-pay-token'] || ''), 'pay');
  if (!payload) throw unauthorized('Your session expired. Please verify again.');
  req.leaseId = payload.lease;
  next();
}
