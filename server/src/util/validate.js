import { z } from 'zod';
import { badRequest } from './errors.js';

const label = (path) => String(path[path.length - 1] ?? 'this field').replace(/_/g, ' ');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Turn a zod issue into a sentence a landlord or tenant can act on. */
function friendly(issue) {
  const name = label(issue.path);
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null'
        ? `Please enter ${name}.`
        : `${cap(name)} is not in the right format.`;
    case 'invalid_union':
      return `Please enter a valid ${name}.`;
    case 'invalid_enum_value':
      return `Please choose a valid ${name}.`;
    case 'too_small':
      return issue.type === 'string' && issue.minimum <= 1 ? `Please enter ${name}.` : `${cap(name)} is too small or too short.`;
    case 'too_big':
      return `${cap(name)} is too large or too long.`;
    case 'invalid_string':
      if (issue.validation === 'email') return 'Enter a valid email address.';
      if (issue.validation === 'uuid') return `Please choose ${name}.`;
      return issue.message;
    default:
      return issue.message;
  }
}

/** Parse and return data, or throw a 400 with a friendly message. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: friendly(i) }));
    throw badRequest(details[0]?.message ?? 'Please check the details and try again.', details);
  }
  return result.data;
}

// Money as a decimal string with up to 2 places, e.g. "15000" or "15000.50".
export const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), 'Enter a valid amount (numbers only, up to 2 decimals).');

export const positiveMoney = money.refine((v) => Number(v) > 0, 'Amount must be greater than zero.');

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.');
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the month format YYYY-MM.');
