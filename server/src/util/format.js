export const kes = (n) => `KES ${Number(n ?? 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
export const firstName = (full) => String(full ?? '').trim().split(/\s+/)[0] || 'there';
