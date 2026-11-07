import cron from 'node-cron';
import { config } from './config.js';
import { generateInvoices, markOverdue, reconcilePending, sendReminders } from './services/billing.js';
import { purgeExpired } from './services/tenancy.js';
import { logActivity } from './services/activity.js';

export const jobs = {
  'generate-invoices': async () => {
    const created = await generateInvoices();
    if (created > 0) await logActivity({ category: 'finance', action: 'invoices_generated', message: `${created} rent invoice(s) were generated.` });
    return { created };
  },
  'mark-overdue': markOverdue,
  'send-reminders': sendReminders,
  'reconcile-pending': reconcilePending,
  'purge-archives': purgeExpired,
};

async function run(name) {
  try {
    console.log(`[job] ${name}`, await jobs[name]());
  } catch (err) {
    console.error(`[job] ${name} failed:`, err.message);
  }
}

export function startJobs() {
  const tz = { timezone: config.tz };
  cron.schedule('30 0 1 * *', () => run('generate-invoices'), tz);
  cron.schedule('10 0 * * *', () => run('mark-overdue'), tz);
  cron.schedule('0 2 * * *', () => run('purge-archives'), tz);
  cron.schedule('0 8 * * *', () => run('send-reminders'), tz);
  cron.schedule('*/10 * * * *', () => run('reconcile-pending'), tz);
  run('purge-archives'); // catch up after downtime
  console.log('Background jobs scheduled.');
}
