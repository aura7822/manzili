import './env.js';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { config } from '../src/config.js';
import { createUser, login, pool, query, resetDb, startServer } from './helpers.js';
import { mpesa } from '../src/services/mpesa.js';
import { generateInvoices, markOverdue, reconcilePending, sendReminders } from '../src/services/billing.js';
import { purgeExpired } from '../src/services/tenancy.js';

// Capture outgoing SMS instead of calling Africa's Talking.
const sms = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  if (String(url).includes('africastalking')) {
    sms.push(Object.fromEntries(new URLSearchParams(String(opts.body))));
    return Promise.resolve(new Response('{}', { status: 201 }));
  }
  return realFetch(url, opts);
};

let api;
let adminToken;
const ctx = {};
const auth = () => ({ token: adminToken });

/** Current Nairobi time as Safaricom formats it: YYYYMMDDHHmmss. */
const mpesaNow = () => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  return Number(`${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`);
};

const webhookBody = (checkoutId, { code = 0, amount = 5000, receipt = 'QWE123ABC' } = {}) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: 'm1',
      CheckoutRequestID: checkoutId,
      ResultCode: code,
      ResultDesc: code === 0 ? 'The service request is processed successfully.' : 'Request cancelled by user',
      ...(code === 0
        ? { CallbackMetadata: { Item: [
            { Name: 'Amount', Value: amount },
            { Name: 'MpesaReceiptNumber', Value: receipt },
            { Name: 'TransactionDate', Value: mpesaNow() },
            { Name: 'PhoneNumber', Value: 254712000001 },
          ] } }
        : {}),
    },
  },
});

const waitFor = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for condition');
};

const onboard = (body) => api.call('POST', '/api/tenants', { ...auth(), body });

before(async () => {
  await resetDb();
  await createUser('admin@test.com', 'admin');
  await createUser('landlord@test.com', 'landlord');
  await createUser('care@test.com', 'caretaker');
  api = await startServer();
  adminToken = await login(api.call, 'admin@test.com');
});

after(async () => {
  await api.close();
  await pool.end();
});

describe('auth and friendly errors', () => {
  it('rejects bad credentials and unauthenticated access with clear messages', async () => {
    const bad = await api.call('POST', '/api/auth/login', { body: { email: 'admin@test.com', password: 'nope' } });
    assert.equal(bad.status, 401);
    assert.match(bad.data.message, /not right/);
    assert.equal((await api.call('GET', '/api/properties')).status, 401);
    const me = await api.call('GET', '/api/auth/me', auth());
    assert.equal(me.data.user.role, 'admin');
  });

  it('explains validation problems in plain language', async () => {
    const res = await onboard({});
    assert.equal(res.status, 400);
    assert.equal(res.data.message, 'Please enter full name.');
    const unknown = await api.call('GET', '/api/nothing-here', auth());
    assert.equal(unknown.status, 404);
  });
});

describe('houses and tenants', () => {
  it('creates a property and houses', async () => {
    const prop = await api.call('POST', '/api/properties', { ...auth(), body: { name: 'Sunrise Apartments', address: 'Kenyatta Rd', city: 'Thika' } });
    assert.equal(prop.status, 201);
    assert.equal(prop.data.slug, 'sunrise-apartments');
    ctx.propertyId = prop.data.id;

    for (const [num, floor, key] of [['A1', 1, 'a1'], ['B1', 2, 'b1'], ['C1', 3, 'c1']]) {
      const u = await api.call('POST', '/api/units', { ...auth(), body: { property_id: ctx.propertyId, unit_number: num, floor_number: floor, unit_type: 'single', monthly_rent: 10000 } });
      assert.equal(u.status, 201);
      ctx[key] = u.data.id;
    }

    const dup = await api.call('POST', '/api/units', { ...auth(), body: { property_id: ctx.propertyId, unit_number: 'A1', unit_type: 'single', monthly_rent: 100 } });
    assert.equal(dup.status, 409);
    assert.match(dup.data.message, /already exists/);

    const badRent = await api.call('POST', '/api/units', { ...auth(), body: { property_id: ctx.propertyId, unit_number: 'Z', unit_type: 'single', monthly_rent: 'abc' } });
    assert.equal(badRent.status, 400);
    assert.match(badRent.data.message, /valid amount/);
  });

  it('adds tenants to vacant houses with a type, and starts billing', async () => {
    const jane = await onboard({ full_name: 'Jane Mwangi', phone: '0712 000 001', national_id: '30000001', unit_id: ctx.a1, unit_type: 'single', rent_amount: 15000, rent_due_day: 5 });
    assert.equal(jane.status, 201);
    ctx.janeId = jane.data.id;

    const peter = await onboard({ full_name: 'Peter Otieno', phone: '0712000002', national_id: '30000002', unit_id: ctx.b1, unit_type: 'bedsitter', rent_amount: 8000, rent_due_day: 5 });
    assert.equal(peter.status, 201);
    ctx.peterId = peter.data.id;

    const units = (await api.call('GET', '/api/units/overview', auth())).data;
    const a1 = units.find((u) => u.unit_number === 'A1');
    assert.equal(a1.status, 'occupied');
    assert.equal(a1.unit_type, 'single');
    assert.equal(a1.tenant_name, 'Jane Mwangi');
    assert.equal(a1.monthly_rent, '15000.00');
    assert.equal(units.find((u) => u.unit_number === 'C1').status, 'vacant');
    assert.ok(!('size_sqm' in a1));

    const tenants = (await api.call('GET', '/api/tenants', auth())).data;
    assert.equal(tenants.length, 2);
    const row = tenants.find((t) => t.full_name === 'Jane Mwangi');
    assert.equal(row.unit_number, 'A1');
    assert.equal(row.rent_status, 'pending');
    assert.ok(row.created_at);
  });

  it('blocks double-booking, duplicates and bad phone numbers with friendly messages', async () => {
    const occupied = await onboard({ full_name: 'X Y', phone: '0722000003', national_id: '30000003', unit_id: ctx.a1, unit_type: 'single', rent_amount: 1000, rent_due_day: 5 });
    assert.equal(occupied.status, 409);
    assert.match(occupied.data.message, /already occupied/);

    const samePhone = await onboard({ full_name: 'X Y', phone: '0712000001', national_id: '30000009', unit_id: ctx.c1, unit_type: 'single', rent_amount: 1000, rent_due_day: 5 });
    assert.equal(samePhone.status, 409);
    assert.match(samePhone.data.message, /phone number already belongs/);

    const badPhone = await onboard({ full_name: 'X Y', phone: '123', national_id: '30000004', unit_id: ctx.c1, unit_type: 'single', rent_amount: 1000, rent_due_day: 5 });
    assert.equal(badPhone.status, 400);
    assert.match(badPhone.data.message, /phone number looks too short/);

    const badType = await onboard({ full_name: 'X Y', phone: '0722000005', national_id: '30000005', unit_id: ctx.c1, unit_type: 'mansion', rent_amount: 1000, rent_due_day: 5 });
    assert.equal(badType.status, 400);

    // Nothing was half-created by the failed attempts.
    const count = await query(`SELECT count(*)::int AS n FROM tenants`);
    assert.equal(count.rows[0].n, 2);
  });
});

describe('tenant QR payment flow', () => {
  it('lists occupied houses only and verifies unit + phone', async () => {
    const list = await api.call('GET', '/api/public/properties/sunrise-apartments/units');
    assert.deepEqual(list.data.units.map((u) => u.unit_number), ['A1', 'B1']);

    const wrong = await api.call('POST', '/api/public/verify', { body: { slug: 'sunrise-apartments', unit_id: ctx.a1, phone: '0700000000' } });
    assert.equal(wrong.status, 422);
    const ok = await api.call('POST', '/api/public/verify', { body: { slug: 'sunrise-apartments', unit_id: ctx.a1, phone: '+254 712 000 001' } });
    assert.equal(ok.status, 200);
    ctx.payToken = ok.data.token;
  });

  it('starts an STK push and logs it', async () => {
    const inv = await api.call('GET', '/api/public/invoice', { headers: { 'X-Pay-Token': ctx.payToken } });
    ctx.invoiceId = inv.data.invoice.id;
    assert.equal(inv.data.invoice.balance, '15000.00');

    mpesa.stkPush = async () => ({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_TEST_1' });
    const pay = await api.call('POST', '/api/public/pay/mpesa', {
      headers: { 'X-Pay-Token': ctx.payToken }, body: { invoice_id: ctx.invoiceId, amount: 5000, phone: '0712000001' },
    });
    assert.equal(pay.status, 201);
    ctx.txnId = pay.data.transaction_id;

    const dupe = await api.call('POST', '/api/public/pay/mpesa', {
      headers: { 'X-Pay-Token': ctx.payToken }, body: { invoice_id: ctx.invoiceId, amount: 5000, phone: '0712000001' },
    });
    assert.equal(dupe.status, 409);
  });

  it('rejects a wrong webhook secret and credits once on replay', async () => {
    assert.equal((await api.call('POST', '/api/webhooks/mpesa/wrong/stk', { body: webhookBody('ws_CO_TEST_1') })).status, 404);

    const url = '/api/webhooks/mpesa/whsec_test/stk';
    await api.call('POST', url, { body: webhookBody('ws_CO_TEST_1', { amount: 5000 }) });
    const txn = await waitFor(async () => {
      const { rows } = await query('SELECT * FROM transactions WHERE id = $1', [ctx.txnId]);
      return rows[0].status === 'success' ? rows[0] : null;
    });
    ctx.receipt = txn.receipt_number;
    assert.match(txn.receipt_number, /^RCP-\d{4}-\d{6}-[0-9A-F]{6}$/);

    await api.call('POST', url, { body: webhookBody('ws_CO_TEST_1', { amount: 5000 }) });
    await new Promise((r) => setTimeout(r, 300));
    const inv = await query('SELECT amount_paid, status FROM invoices WHERE id = $1', [ctx.invoiceId]);
    assert.equal(inv.rows[0].amount_paid, '5000.00');
    assert.equal(inv.rows[0].status, 'partial');
  });

  it('serves the receipt PDF', async () => {
    const pdf = await fetch(`${api.base}/api/public/receipts/${ctx.receipt}`);
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  });

  it('records a cancelled prompt without crediting', async () => {
    mpesa.stkPush = async () => ({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_TEST_2' });
    await query(`UPDATE transactions SET initiated_at = now() - interval '5 minutes' WHERE id = $1`, [ctx.txnId]);
    const pay = await api.call('POST', '/api/public/pay/mpesa', {
      headers: { 'X-Pay-Token': ctx.payToken }, body: { invoice_id: ctx.invoiceId, amount: 1000, phone: '0712000001' },
    });
    await api.call('POST', '/api/webhooks/mpesa/whsec_test/stk', { body: webhookBody('ws_CO_TEST_2', { code: 1032 }) });
    await waitFor(async () => (await query('SELECT status FROM transactions WHERE id = $1', [pay.data.transaction_id])).rows[0].status === 'cancelled');
    assert.equal((await query('SELECT amount_paid FROM invoices WHERE id = $1', [ctx.invoiceId])).rows[0].amount_paid, '5000.00');
  });
});

describe('rent status and reminders', () => {
  it('shows partial, then paid after a manual payment, and refuses reminders when paid', async () => {
    const before = (await api.call('GET', '/api/tenants', auth())).data.find((t) => t.id === ctx.janeId);
    assert.equal(before.rent_status, 'partial');
    assert.equal(before.balance, '10000.00');

    const over = await api.call('POST', '/api/transactions/manual', { ...auth(), body: { invoice_id: ctx.invoiceId, amount: 99999, method: 'cash' } });
    assert.equal(over.status, 400);
    const pay = await api.call('POST', '/api/transactions/manual', { ...auth(), body: { invoice_id: ctx.invoiceId, amount: '10000', method: 'cash' } });
    assert.equal(pay.status, 201);

    const after = (await api.call('GET', '/api/tenants', auth())).data.find((t) => t.id === ctx.janeId);
    assert.equal(after.rent_status, 'paid');

    const remind = await api.call('POST', `/api/tenants/${ctx.janeId}/remind`, auth());
    assert.equal(remind.status, 400);
    assert.match(remind.data.message, /nothing to remind/);
  });

  it('flags overdue rent immediately and sends a reminder', async () => {
    await query(`UPDATE invoices SET due_date = CURRENT_DATE - 3
                  WHERE lease_id = (SELECT id FROM leases WHERE tenant_id = $1)`, [ctx.peterId]);
    const row = (await api.call('GET', '/api/tenants?status=overdue', auth())).data;
    assert.equal(row.length, 1);
    assert.equal(row[0].full_name, 'Peter Otieno');
    assert.equal(row[0].rent_status, 'overdue');

    sms.length = 0;
    const remind = await api.call('POST', `/api/tenants/${ctx.peterId}/remind`, auth());
    assert.equal(remind.status, 200);
    assert.equal(remind.data.delivered, true);
    assert.equal(sms.length, 1);
    assert.match(sms[0].message, /overdue/);
    assert.equal(sms[0].to, '+254712000002');
  });

  it('reports a clear message when SMS cannot be delivered', async () => {
    const key = config.sms.apiKey;
    config.sms.apiKey = '';
    const remind = await api.call('POST', `/api/tenants/${ctx.peterId}/remind`, auth());
    config.sms.apiKey = key;
    assert.equal(remind.status, 200);
    assert.equal(remind.data.delivered, false);
    assert.match(remind.data.message, /could not be delivered/);
  });
});

describe('broadcast', () => {
  const preview = (filters) => api.call('POST', '/api/broadcast/preview', { ...auth(), body: { filters } });

  it('filters recipients by house type, floor and rent status', async () => {
    assert.equal((await preview({})).data.count, 2);
    assert.equal((await preview({ unit_type: 'bedsitter' })).data.count, 1);
    assert.equal((await preview({ unit_type: 'single' })).data.sample[0].house, 'A1');
    assert.equal((await preview({ floor: 2 })).data.count, 1);
    assert.equal((await preview({ floor: 3 })).data.count, 0);
    assert.equal((await preview({ status: 'paid' })).data.sample[0].name, 'Jane Mwangi');
    assert.equal((await preview({ status: 'unpaid' })).data.sample[0].name, 'Peter Otieno');
    assert.equal((await preview({ status: 'overdue', unit_type: 'single' })).data.count, 0);
  });

  it('sends personalised messages and reports failures', async () => {
    sms.length = 0;
    const res = await api.call('POST', '/api/broadcast/send', {
      ...auth(), body: { message: 'Hello {name}, water is off tomorrow at house {house}.', filters: { status: 'unpaid' } },
    });
    assert.deepEqual([res.data.total, res.data.sent, res.data.failed], [1, 1, 0]);
    assert.equal(sms[0].message, 'Hello Peter, water is off tomorrow at house B1.');

    const empty = await api.call('POST', '/api/broadcast/send', { ...auth(), body: { message: 'Hi', filters: { floor: 9 } } });
    assert.equal(empty.status, 400);
    assert.match(empty.data.message, /No tenants match/);

    const key = config.sms.apiKey;
    config.sms.apiKey = '';
    const failed = await api.call('POST', '/api/broadcast/send', { ...auth(), body: { message: 'Hi all', filters: {} } });
    config.sms.apiKey = key;
    assert.deepEqual([failed.data.sent, failed.data.failed], [0, 2]);
    assert.match(failed.data.failures[0].reason, /not set up/);
  });
});

describe('dashboard: live feed, events and maintenance spend', () => {
  it('lists recent payments in the live feed', async () => {
    const live = await api.call('GET', '/api/dashboard/live', auth());
    assert.equal(live.status, 200);
    const first = live.data[0];
    assert.equal(first.tenant_name, 'Jane Mwangi');
    assert.equal(first.fully_paid, true);
    assert.equal(first.unit_number, 'A1');
  });

  it('pushes payment events over the live stream', async () => {
    const ac = new AbortController();
    const res = await fetch(`${api.base}/api/events`, { headers: { Authorization: `Bearer ${adminToken}` }, signal: ac.signal });
    assert.match(res.headers.get('content-type'), /event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let seen = decoder.decode((await reader.read()).value);
    assert.match(seen, /connected/);

    const inv = (await query(`SELECT id FROM invoices WHERE lease_id = (SELECT id FROM leases WHERE tenant_id = $1)`, [ctx.peterId])).rows[0];
    await api.call('POST', '/api/transactions/manual', { ...auth(), body: { invoice_id: inv.id, amount: 3000, method: 'cash' } });

    const deadline = Date.now() + 3000;
    while (!seen.includes('event: payment') && Date.now() < deadline) seen += decoder.decode((await reader.read()).value);
    ac.abort();
    assert.match(seen, /event: payment/);
    assert.match(seen, /Peter Otieno/);
  });

  it('deducts manually entered maintenance spend from net income', async () => {
    const before = (await api.call('GET', '/api/dashboard/summary', auth())).data;
    assert.equal(before.collected, '18000.00'); // 15,000 (Jane) + 3,000 (Peter)
    assert.equal(before.net_income, '18000.00');

    const set = await api.call('PUT', '/api/dashboard/maintenance-spend', { ...auth(), body: { property_id: ctx.propertyId, amount: '2500.50', note: 'Plumber' } });
    assert.equal(set.status, 200);

    const after = (await api.call('GET', '/api/dashboard/summary', auth())).data;
    assert.equal(after.maintenance_spent, '2500.50');
    assert.equal(after.net_income, '15499.50');
    assert.equal(after.revenue_trend.at(-1).net, '15499.50');
    assert.equal(after.revenue_trend.length, 6);
    assert.equal(after.occupied_units, 2);
    assert.equal(after.vacant_units, 1);
    assert.ok(after.maintenance_properties[0].amount === '2500.50');
    assert.ok(!('open_requests' in (after.maintenance ?? {})));

    // Updating replaces the figure.
    await api.call('PUT', '/api/dashboard/maintenance-spend', { ...auth(), body: { property_id: ctx.propertyId, amount: '0' } });
    assert.equal((await api.call('GET', '/api/dashboard/summary', auth())).data.net_income, '18000.00');
    await api.call('PUT', '/api/dashboard/maintenance-spend', { ...auth(), body: { property_id: ctx.propertyId, amount: '2500.50' } });
  });
});

describe('vacating and archives', () => {
  it('vacates a house: archives the tenant, erases details and frees the unit', async () => {
    const res = await api.call('POST', `/api/units/${ctx.b1}/vacate`, auth());
    assert.equal(res.status, 200);
    assert.equal(res.data.tenant_name, 'Peter Otieno');
    assert.equal(res.data.outstanding_balance, '5000.00'); // 8,000 rent - 3,000 paid

    const unit = (await api.call('GET', '/api/units/overview', auth())).data.find((u) => u.unit_number === 'B1');
    assert.equal(unit.status, 'vacant');
    assert.equal(unit.tenant_name, null);
    assert.equal(unit.tenant_phone, null);
    assert.equal(unit.unit_type, 'bedsitter');

    const tenants = (await api.call('GET', '/api/tenants', auth())).data;
    assert.deepEqual(tenants.map((t) => t.full_name), ['Jane Mwangi']);

    const row = (await query('SELECT full_name, phone, national_id, email FROM tenants WHERE id = $1', [ctx.peterId])).rows[0];
    assert.equal(row.full_name, 'Former tenant');
    assert.match(row.phone, /^del-/);
    assert.equal(row.email, null);
    assert.equal((await query('SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1', [ctx.peterId])).rows[0].n, 0);
    assert.equal((await query(`SELECT status FROM invoices WHERE lease_id = (SELECT id FROM leases WHERE tenant_id = $1)`, [ctx.peterId])).rows[0].status, 'void');

    const again = await api.call('POST', `/api/units/${ctx.b1}/vacate`, auth());
    assert.equal(again.status, 400);
    assert.match(again.data.message, /already vacant/);
  });

  it('keeps the archived details for 60 days', async () => {
    const list = (await api.call('GET', '/api/archives', auth())).data;
    assert.equal(list.length, 1);
    assert.equal(list[0].tenant_name, 'Peter Otieno');
    assert.equal(list[0].phone, '254712000002');
    assert.equal(list[0].unit_number, 'B1');
    assert.equal(list[0].total_paid, '3000.00');
    assert.equal(list[0].days_left, 60);
  });

  it('frees the phone number so the house can be re-let and removes the house from the pay page', async () => {
    const pub = await api.call('GET', '/api/public/properties/sunrise-apartments/units');
    assert.deepEqual(pub.data.units.map((u) => u.unit_number), ['A1']);

    const again = await onboard({ full_name: 'Peter Otieno', phone: '0712000002', national_id: '30000002', unit_id: ctx.b1, unit_type: 'bedsitter', rent_amount: 8000, rent_due_day: 5 });
    assert.equal(again.status, 201);
  });

  it('auto-deletes archives after their retention period', async () => {
    await query(`UPDATE archives SET purge_at = now() - interval '1 day'`);
    const list = (await api.call('GET', '/api/archives', auth())).data;
    assert.equal(list.length, 0);
    const purged = await purgeExpired();
    assert.equal(typeof purged.archives, 'number');
  });
});

describe('activity logs', () => {
  it('records every M-Pesa message and other activity', async () => {
    const mp = (await api.call('GET', '/api/logs?category=mpesa', auth())).data.items.map((i) => i.message);
    assert.ok(mp.some((m) => /prompt for KES 5,000 sent to 2547\*\*\*\*001/.test(m)), 'STK prompt logged with masked phone');
    assert.ok(mp.some((m) => /M-Pesa confirmed KES 5,000/.test(m) && /QWE123ABC/.test(m)), 'success callback logged');
    assert.ok(mp.some((m) => /cancelled by user/.test(m)), 'cancelled callback logged');

    const all = (await api.call('GET', '/api/logs?limit=200', auth())).data.items;
    const cats = new Set(all.map((i) => i.category));
    for (const c of ['auth', 'tenant', 'unit', 'payment', 'message', 'broadcast', 'finance', 'mpesa', 'system']) {
      assert.ok(cats.has(c), `category ${c} present`);
    }
    assert.ok(all.some((i) => /was vacated/.test(i.message)));

    const search = (await api.call('GET', '/api/logs?q=water%20is%20off', auth())).data.items;
    assert.equal(search.length, 1);

    const page = (await api.call('GET', '/api/logs?limit=3', auth())).data;
    assert.equal(page.items.length, 3);
    assert.ok(page.next_before);
    const next = (await api.call('GET', `/api/logs?limit=3&before=${page.next_before}`, auth())).data;
    assert.ok(next.items[0].id < page.next_before);
  });
});

describe('jobs', () => {
  it('runs scheduled jobs safely and idempotently', async () => {
    assert.equal(await generateInvoices(), 0); // invoices for this month already exist
    const overdue = await markOverdue();
    assert.equal(typeof overdue.overdue, 'number');
    assert.equal(typeof (await sendReminders()).sent, 'number');
    assert.equal(typeof (await reconcilePending()).checked, 'number');
  });
});


describe('house types, phone formats, deposits and prices', () => {
  const dates = {};
  const unit = (body) => api.call('POST', '/api/units', { ...auth(), body: { property_id: ctx.propertyId, ...body } });
  const setPrices = (rules, apply = false) =>
    api.call('PUT', `/api/properties/${ctx.propertyId}/pricing`, { ...auth(), body: { rules, apply_to_vacant: apply } });

  before(async () => {
    const r = await query(`SELECT CURRENT_DATE::text AS today, (CURRENT_DATE - 1)::text AS y, (CURRENT_DATE - 3)::text AS d3,
                                  (CURRENT_DATE - 14)::text AS d14, (CURRENT_DATE - 15)::text AS d15, (CURRENT_DATE + 1)::text AS tomorrow`);
    Object.assign(dates, r.rows[0]);
  });

  it('needs a price when none is set, then auto-fills from the price list (floor price wins)', async () => {
    const none = await unit({ unit_number: 'D1', floor_number: 1, unit_type: '2_bedroom' });
    assert.equal(none.status, 400);
    assert.match(none.data.message, /Prices/);

    const dupe = await setPrices([{ unit_type: 'studio', monthly_rent: '9000' }, { unit_type: 'studio', monthly_rent: '9500' }]);
    assert.equal(dupe.status, 400);
    assert.match(dupe.data.message, /one price per floor/);

    const ok = await setPrices([
      { unit_type: '2_bedroom', floor_number: null, monthly_rent: '20000' },
      { unit_type: '2_bedroom', floor_number: 3, monthly_rent: '25000' },
      { unit_type: 'studio', floor_number: null, monthly_rent: '9000' },
    ]);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.rules, 3);

    const look = (floor) => api.call('GET', `/api/pricing/lookup?property_id=${ctx.propertyId}&unit_type=2_bedroom&floor=${floor}`, auth());
    assert.equal((await look(1)).data.monthly_rent, '20000.00');
    assert.equal((await look(3)).data.monthly_rent, '25000.00');
    assert.equal((await api.call('GET', `/api/pricing/lookup?property_id=${ctx.propertyId}&unit_type=4_bedroom&floor=1`, auth())).data.monthly_rent, null);

    const d1 = await unit({ unit_number: 'D1', floor_number: 1, unit_type: '2_bedroom' });
    const d2 = await unit({ unit_number: 'D2', floor_number: 3, unit_type: '2_bedroom' });
    assert.equal(d1.data.monthly_rent, '20000.00');
    assert.equal(d2.data.monthly_rent, '25000.00');
    ctx.d1 = d1.data.id;
    ctx.d2 = d2.data.id;

    const bad = await unit({ unit_number: 'D3', unit_type: 'castle', monthly_rent: '1' });
    assert.equal(bad.status, 400);
  });

  it('can re-price vacant houses to match new prices', async () => {
    const res = await setPrices([
      { unit_type: '2_bedroom', floor_number: null, monthly_rent: '21000' },
      { unit_type: '2_bedroom', floor_number: 3, monthly_rent: '25000' },
      { unit_type: 'studio', floor_number: null, monthly_rent: '9000' },
    ], true);
    assert.ok(res.data.updated_units >= 2);
    const units = (await api.call('GET', '/api/units/overview', auth())).data;
    assert.equal(units.find((u) => u.unit_number === 'D1').monthly_rent, '21000.00');
    assert.equal(units.find((u) => u.unit_number === 'D2').monthly_rent, '25000.00');
    assert.equal((await api.call('GET', '/api/pricing', auth())).data.length, 3);
  });

  it('accepts any house type, 01 numbers and international numbers, and records deposits', async () => {
    const x = await onboard({
      full_name: 'Xavier Kamau', phone: '0112 345 678', national_id: '40000001', unit_id: ctx.d1, unit_type: '2_bedroom',
      rent_due_day: 5, deposit_amount: '21000', deposit_paid: true,
    });
    assert.equal(x.status, 201);
    ctx.xId = x.data.id;

    const y = await onboard({
      full_name: 'Yvonne Smith', phone: '+44 7700 900123', national_id: '40000002', unit_id: ctx.d2, unit_type: '2_bedroom',
      rent_amount: '25000', rent_due_day: 5, deposit_amount: '25000', deposit_paid: false,
    });
    assert.equal(y.status, 201);
    ctx.yId = y.data.id;

    const tenants = (await api.call('GET', '/api/tenants', auth())).data;
    const tx = tenants.find((t) => t.id === ctx.xId);
    const ty = tenants.find((t) => t.id === ctx.yId);
    assert.equal(tx.phone, '254112345678');
    assert.equal(ty.phone, '447700900123');
    assert.equal(tx.rent_amount, '21000.00'); // blank rent used the price list
    assert.equal(tx.deposit_status, 'held');
    assert.equal(ty.deposit_status, 'pending');

    const row = (await api.call('GET', '/api/units/overview', auth())).data.find((u) => u.unit_number === 'D2');
    assert.equal(row.deposit_status, 'pending');
    assert.equal(row.deposit_amount, '25000.00');
    assert.equal(row.unit_type, '2_bedroom');

    const pay = await api.call('PATCH', `/api/tenants/${ctx.yId}`, { ...auth(), body: { deposit_paid: true } });
    assert.equal(pay.status, 200);
    assert.equal((await api.call('GET', '/api/tenants', auth())).data.find((t) => t.id === ctx.yId).deposit_status, 'held');
  });

  it('validates phone length and email reminders', async () => {
    const short = await onboard({ full_name: 'Q', phone: '12345', national_id: '40000003', unit_id: ctx.c1, unit_type: 'studio', rent_amount: '9000', rent_due_day: 5 });
    assert.equal(short.status, 400);
    const noEmail = await onboard({ full_name: 'Q', phone: '0733000999', national_id: '40000003', unit_id: ctx.c1, unit_type: 'studio', rent_amount: '9000', rent_due_day: 5, preferred_channel: 'email' });
    assert.equal(noEmail.status, 400);
    assert.match(noEmail.data.message, /email address/);
    const withEmail = await onboard({ full_name: 'Quinn Email', phone: '0733000999', email: 'quinn@test.com', national_id: '40000003', unit_id: ctx.c1, unit_type: 'studio', rent_amount: '9000', rent_due_day: 5, preferred_channel: 'email' });
    assert.equal(withEmail.status, 201);
    ctx.quinnId = withEmail.data.id;
  });

  it('lets tenants with 01 numbers pay through the QR page', async () => {
    const v = await api.call('POST', '/api/public/verify', { body: { slug: 'sunrise-apartments', unit_id: ctx.d1, phone: '0112 345 678' } });
    assert.equal(v.status, 200);
    const inv = (await api.call('GET', '/api/public/invoice', { headers: { 'X-Pay-Token': v.data.token } })).data.invoice;
    mpesa.stkPush = async ({ phone }) => { ctx.pushedPhone = phone; return { ResponseCode: '0', CheckoutRequestID: 'ws_CO_TEST_01' }; };
    const pay = await api.call('POST', '/api/public/pay/mpesa', { headers: { 'X-Pay-Token': v.data.token }, body: { invoice_id: inv.id, amount: 1000, phone: '0112 345 678' } });
    assert.equal(pay.status, 201);
    assert.equal(ctx.pushedPhone, '254112345678');

    const intl = await api.call('POST', '/api/public/pay/mpesa', { headers: { 'X-Pay-Token': v.data.token }, body: { invoice_id: inv.id, amount: 1000, phone: '+44 7700 900123' } });
    assert.equal(intl.status, 400);
    assert.match(intl.data.message, /M-Pesa number/);
  });

  it('broadcasts by deposit status, house type and hand-picked tenants', async () => {
    const preview = (body) => api.call('POST', '/api/broadcast/preview', { ...auth(), body });
    assert.equal((await preview({ filters: { deposit: 'paid' } })).data.count, 2);
    assert.equal((await preview({ filters: { deposit: 'pending' } })).data.count, 0); // tenants with no deposit owed are not "pending"
    const owe = await api.call('PATCH', `/api/tenants/${ctx.quinnId}`, { ...auth(), body: { deposit_amount: '9000', deposit_paid: false } });
    assert.equal(owe.status, 200);
    assert.equal((await preview({ filters: { deposit: 'pending' } })).data.count, 1);
    assert.equal((await preview({ filters: { unit_type: '2_bedroom' } })).data.count, 2);
    assert.equal((await preview({ filters: { unit_type: 'studio' } })).data.count, 1);

    const picked = await preview({ filters: {}, tenant_ids: [ctx.xId] });
    assert.equal(picked.data.count, 1);
    assert.equal(picked.data.recipients[0].name, 'Xavier Kamau');
    assert.equal(picked.data.recipients[0].deposit_status, 'held');
    assert.equal((await preview({ filters: { unit_type: 'single' }, tenant_ids: [ctx.xId] })).data.count, 0);

    const all = (await preview({ filters: {} })).data;
    assert.ok(all.recipients.length >= 5 && all.recipients.every((r) => r.id && r.house));

    sms.length = 0;
    const res = await api.call('POST', '/api/broadcast/send', { ...auth(), body: { message: 'Hi {name}', filters: {}, tenant_ids: [ctx.yId] } });
    assert.deepEqual([res.data.total, res.data.sent], [1, 1]);
    assert.equal(sms[0].to, '+447700900123');
    assert.equal(sms[0].message, 'Hi Yvonne');
  });

  it('shows houses by type and a per-property view', async () => {
    const p2 = await api.call('POST', '/api/properties', { ...auth(), body: { name: 'Second Court', address: 'Moi Ave' } });
    assert.equal(p2.status, 201);
    const s1 = await api.call('POST', '/api/units', { ...auth(), body: { property_id: p2.data.id, unit_number: 'S1', floor_number: 0, unit_type: 'studio', monthly_rent: '9000' } });
    assert.equal(s1.status, 201);

    const global = (await api.call('GET', '/api/dashboard/summary', auth())).data;
    const two = global.by_type.find((t) => t.unit_type === '2_bedroom');
    assert.deepEqual([two.total, two.occupied, two.vacant], [2, 2, 0]);
    assert.equal(global.by_type.find((t) => t.unit_type === 'studio').total, 2); // C1 + S1
    assert.equal(global.deposits.held, '46000.00');
    assert.equal(global.deposits.pending_count, 1);
    assert.equal(global.deposits.pending, '9000.00');

    const only2 = (await api.call('GET', `/api/dashboard/summary?property_id=${p2.data.id}`, auth())).data;
    assert.equal(only2.total_units, 1);
    assert.equal(only2.occupied_units, 0);
    assert.deepEqual(only2.by_type.map((t) => [t.unit_type, t.total]), [['studio', 1]]);
    assert.equal(Number(only2.collected), 0);

    const only1 = (await api.call('GET', `/api/dashboard/summary?property_id=${ctx.propertyId}`, auth())).data;
    assert.equal(only1.total_units, global.total_units - 1);
    assert.equal(only1.collected, global.collected);
    assert.equal((await api.call('GET', `/api/dashboard/live?property_id=${p2.data.id}`, auth())).data.length, 0);
  });

  it('rebuilds the dashboard as it was on an earlier day, up to 2 weeks back', async () => {
    const get = (date) => api.call('GET', `/api/dashboard/summary?date=${date}`, auth());

    assert.equal((await get(dates.tomorrow)).status, 400);
    assert.match((await get(dates.tomorrow)).data.message, /future/);
    assert.equal((await get(dates.d15)).status, 400);
    assert.match((await get(dates.d15)).data.message, /2 weeks/);
    assert.equal((await get('2026-02-31')).status, 400);
    assert.equal((await get(dates.d14)).status, 200);

    // Everything in this test run happened today, so yesterday looks empty.
    const today = (await get(dates.today)).data;
    const yesterday = (await get(dates.y)).data;
    assert.equal(today.is_today, true);
    assert.ok(Number(today.collected) > 0);
    assert.equal(yesterday.is_today, false);
    assert.equal(Number(yesterday.collected), 0);
    assert.equal(yesterday.total_units, 0);
    assert.equal(yesterday.deposits, null);
    assert.equal((await api.call('GET', `/api/dashboard/live?date=${dates.y}`, auth())).data.length, 0);

    // Make the houses 10 days old and Jane's tenancy 6 days old: 3 days ago only Jane was living there.
    await query(`UPDATE units SET created_at = now() - interval '10 days'`);
    await query(`UPDATE leases SET start_date = CURRENT_DATE - 6 WHERE tenant_id = $1`, [ctx.janeId]);
    const back = (await get(dates.d3)).data;
    const now = (await get(dates.today)).data;
    assert.equal(back.total_units, now.total_units);
    assert.equal(back.occupied_units, 1);
    assert.ok(now.occupied_units > back.occupied_units);
    assert.equal((await get(dates.d14)).data.total_units, 0); // houses did not exist yet
  });
});

describe('access control', () => {
  it('limits landlords to their own properties', async () => {
    const t = await login(api.call, 'landlord@test.com');
    const l = { token: t };
    assert.equal((await api.call('GET', '/api/properties', l)).data.length, 0);
    assert.equal((await api.call('GET', '/api/units/overview', l)).data.length, 0);
    assert.equal((await api.call('GET', '/api/tenants', l)).data.length, 0);
    assert.equal((await api.call('GET', '/api/dashboard/live', l)).data.length, 0);
    assert.equal((await api.call('GET', '/api/dashboard/summary', l)).data.total_units, 0);
    assert.equal((await api.call('GET', '/api/logs?category=mpesa', l)).data.items.length, 0);
    assert.equal((await api.call('GET', '/api/archives', l)).data.length, 0);
    assert.equal((await api.call('POST', `/api/units/${ctx.a1}/vacate`, l)).status, 404);
    assert.equal((await api.call('PUT', '/api/dashboard/maintenance-spend', { ...l, body: { property_id: ctx.propertyId, amount: '5' } })).status, 404);
    const broadcast = await api.call('POST', '/api/broadcast/send', { ...l, body: { message: 'Hi', filters: {} } });
    assert.equal(broadcast.status, 400); // no tenants in scope, so nothing is sent
  });

  it('lets caretakers read but not change anything sensitive', async () => {
    const t = await login(api.call, 'care@test.com');
    const c = { token: t };
    assert.equal((await api.call('GET', '/api/tenants', c)).status, 200);
    assert.equal((await api.call('GET', '/api/units/overview', c)).status, 200);
    for (const [method, path, body] of [
      ['POST', `/api/units/${ctx.a1}/vacate`], ['POST', '/api/broadcast/send', { message: 'x' }],
      ['GET', '/api/logs'], ['GET', '/api/archives'], ['POST', `/api/tenants/${ctx.janeId}/remind`],
      ['PUT', '/api/dashboard/maintenance-spend', { property_id: ctx.propertyId, amount: '1' }],
    ]) {
      const res = await api.call(method, path, { ...c, body });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
  });
});
