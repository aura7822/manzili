import { query } from '../db.js';

/** 254712345678 -> 2547****678 (keeps logs useful without exposing full numbers). */
export const maskPhone = (phone) => {
  const s = String(phone ?? '');
  return s.length >= 8 ? `${s.slice(0, 4)}****${s.slice(-3)}` : s;
};

/**
 * Append an entry to the activity log. Never throws: logging must not break the action it records.
 * Do not call this inside an open transaction (a failed insert would abort it); call it after commit.
 */
export async function logActivity({ category, action, message, meta = null, actorId = null, propertyId = null }) {
  try {
    await query(
      `INSERT INTO activity_log (category, action, message, meta, actor_id, property_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [category, action, message, meta, actorId, propertyId]
    );
  } catch (err) {
    console.error('Activity log failed:', err.message);
  }
}
