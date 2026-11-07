import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { query } from '../db.js';
import { firstName, kes } from '../util/format.js';
import { logActivity } from './activity.js';

let transport = null;
function mailer() {
  if (!config.smtp.host) throw new Error('Email is not set up yet (SMTP_HOST is missing).');
  transport ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
}

async function sendSms(phone, message) {
  const { username, apiKey, senderId } = config.sms;
  if (!apiKey) throw new Error('SMS is not set up yet (AT_API_KEY is missing).');

  const host = username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
  const body = new URLSearchParams({ username, to: `+${phone}`, message });
  if (senderId) body.set('from', senderId);

  const res = await fetch(`https://${host}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`The SMS provider returned an error (${res.status}).`);
}

export async function sendEmail(to, subject, text) {
  await mailer().sendMail({ from: config.smtp.from, to, subject, text });
}

/**
 * Send one message to a tenant via their preferred channel and record the outcome.
 * Never throws. Returns { id, delivered, error }.
 */
export async function notifyTenant(tenant, kind, message, { invoiceId = null, label = null, propertyId = null, log = true } = {}) {
  const { rows } = await query(
    `INSERT INTO notifications (tenant_id, invoice_id, channel, kind, message)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenant.id, invoiceId, tenant.preferred_channel, kind, message]
  );
  const id = rows[0].id;
  let error = null;

  try {
    if (tenant.preferred_channel === 'sms') await sendSms(tenant.phone, message);
    else if (tenant.preferred_channel === 'email') {
      if (!tenant.email) throw new Error('This tenant has no email address on file.');
      await sendEmail(tenant.email, 'Rent notification', message);
    } else throw new Error(`${tenant.preferred_channel} messages are not available yet.`);

    await query(`UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
  } catch (err) {
    error = err.message;
    await query(`UPDATE notifications SET status = 'failed', error = $2 WHERE id = $1`, [id, error]);
  }

  if (log) {
    await logActivity({
      category: 'message',
      action: error ? 'message_failed' : 'message_sent',
      message: error
        ? `${kind} message to ${label ?? 'tenant'} via ${tenant.preferred_channel} failed: ${error}`
        : `${kind} message sent to ${label ?? 'tenant'} via ${tenant.preferred_channel}.`,
      meta: { notification_id: id, kind },
      propertyId,
    });
  }
  return { id, delivered: !error, error };
}

async function loadInvoiceContext(invoiceId) {
  const { rows } = await query(
    `SELECT i.id, i.amount_due, i.amount_paid, (i.amount_due - i.amount_paid) AS balance,
            to_char(i.billing_period, 'Mon YYYY') AS period,
            to_char(i.due_date, 'DD Mon') AS due_label,
            u.unit_number, p.id AS property_id,
            t.id AS tenant_id, t.full_name, t.phone, t.email, t.preferred_channel
       FROM invoices i
       JOIN leases l ON l.id = i.lease_id
       JOIN units u ON u.id = l.unit_id
       JOIN properties p ON p.id = u.property_id
       JOIN tenants t ON t.id = l.tenant_id
      WHERE i.id = $1`,
    [invoiceId]
  );
  return rows[0];
}

const asTenant = (c) => ({ id: c.tenant_id, phone: c.phone, email: c.email, preferred_channel: c.preferred_channel });

export async function sendInvoiceReminder(invoiceId, kind) {
  const c = await loadInvoiceContext(invoiceId);
  if (!c) return null;

  const when = kind === 'overdue' ? `overdue (was due ${c.due_label})` : `due on ${c.due_label}`;
  const message =
    `Hello ${firstName(c.full_name)}, rent for house ${c.unit_number} (${c.period}) of ${kes(c.amount_due)} is ${when}. ` +
    `Balance: ${kes(c.balance)}. Pay using the QR code at the property.`;

  return notifyTenant(asTenant(c), `${kind} reminder`, message, {
    invoiceId, label: `${c.full_name} (house ${c.unit_number})`, propertyId: c.property_id,
  });
}

export async function sendReceipt(txnId) {
  const { rows } = await query(`SELECT amount, receipt_number, invoice_id FROM transactions WHERE id = $1`, [txnId]);
  if (!rows[0]) return null;

  const c = await loadInvoiceContext(rows[0].invoice_id);
  const message =
    `Payment received: ${kes(rows[0].amount)} for house ${c.unit_number} (${c.period}). ` +
    `Receipt ${rows[0].receipt_number}. Balance: ${kes(c.balance)}. Thank you.`;

  return notifyTenant(asTenant(c), 'receipt', message, {
    invoiceId: rows[0].invoice_id, label: `${c.full_name} (house ${c.unit_number})`, propertyId: c.property_id,
  });
}
