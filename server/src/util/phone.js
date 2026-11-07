/**
 * Normalise a phone number. Kenyan numbers (07xx, 01xx, +2547xx, +2541xx) become 254XXXXXXXXX;
 * any other number is kept as plain digits, so international numbers are accepted too.
 */
export function normalizePhone(raw) {
  let digits = String(raw ?? '').replace(/\D+/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2); // 00254... -> 254...
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9 && (digits[0] === '7' || digits[0] === '1')) return `254${digits}`;
  return digits;
}

/** Any phone number of a plausible length (7 to 15 digits, per the international standard). */
export const isValidPhone = (normalized) => /^\d{7,15}$/.test(normalized);

/** Numbers M-Pesa can prompt: Kenyan, 254 followed by 9 digits (07xx and 01xx lines). */
export const isMpesaNumber = (normalized) => /^254\d{9}$/.test(normalized);
