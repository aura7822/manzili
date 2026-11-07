import { HttpError } from '../util/errors.js';

const PG_MESSAGES = {
  '23505': [409, 'That record already exists.'],
  '23P01': [409, 'This house is already occupied for those dates.'],
  '23503': [400, 'A related record is missing or still in use.'],
  '23514': [400, 'One of the values is not allowed. Please check the amounts and dates.'],
  '22P02': [400, 'One of the values is in the wrong format.'],
};

// More specific wording for common unique-constraint clashes.
const CONSTRAINT_MESSAGES = [
  ['phone', 'That phone number already belongs to another tenant.'],
  ['national_id', 'That ID number is already registered to another tenant.'],
  ['unit_number', 'A house with that number already exists in this property.'],
  ['slug', 'A property with a very similar name already exists.'],
  ['email', 'That email address is already in use.'],
];

export function notFoundHandler(_req, res) {
  res.status(404).json({ message: 'We could not find what you were looking for.' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message, details: err.details });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }
  if (err?.code && PG_MESSAGES[err.code]) {
    const [status, fallback] = PG_MESSAGES[err.code];
    const specific = err.code === '23505' ? CONSTRAINT_MESSAGES.find(([k]) => String(err.constraint).includes(k)) : null;
    return res.status(status).json({ message: specific ? specific[1] : fallback });
  }
  console.error(err);
  return res.status(500).json({ message: 'Something went wrong on our side. Please try again in a moment.' });
}
