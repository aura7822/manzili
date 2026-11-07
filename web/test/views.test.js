import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import fixtures from './fixtures.json';
import { setSession } from '../src/api.js';
import { QUOTES } from '../src/quotes.js';
import { toasts } from '../src/toast.js';
import Archives from '../src/views/Archives.vue';
import Broadcast from '../src/views/Broadcast.vue';
import Dashboard from '../src/views/Dashboard.vue';
import Login from '../src/views/Login.vue';
import Logs from '../src/views/Logs.vue';
import Pay from '../src/views/Pay.vue';
import Tenants from '../src/views/Tenants.vue';
import Units from '../src/views/Units.vue';

const f = fixtures;
const sunrise = f.properties.find((p) => p.name === 'Sunrise Apartments');
const calls = [];
let overrides = {};

/** Fake backend built from real API responses captured from the server. */
function backend(method, path) {
  const key = `${method} ${path.split('?')[0]}`;
  if (overrides[key]) return overrides[key](path);
  const table = {
    'GET /api/properties': () => f.properties,
    'GET /api/pricing': () => f.pricing,
    'GET /api/units/overview': () => (path.includes('status=vacant') ? f.units.filter((u) => u.status === 'vacant') : f.units),
    'GET /api/tenants': () => f.tenants,
    'GET /api/dashboard/summary': () => (path.includes('date=') ? f.past : path.includes('property_id=') ? f.summarySun : f.summary),
    'GET /api/dashboard/live': () => f.live,
    'GET /api/archives': () => f.archives,
    'GET /api/logs': () => f.logs,
    'POST /api/broadcast/preview': () => f.preview,
    'GET /api/public/properties/sunrise-apartments/units': () => f.publicUnits,
  };
  const hit = table[key];
  return hit ? hit() : { status: 404, data: { message: 'not mocked' } };
}

function installFetch() {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const method = opts.method ?? 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, url: String(url), body });
    const r = backend(method, String(url));
    const res = typeof r.status === 'number' && 'data' in r ? r : { status: 200, data: r };
    return { ok: res.status < 400, status: res.status, json: async () => res.data };
  });
}

async function render(component, { query = {}, path = '/' } = {}) {
  const warnings = [];
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/p/:slug', component: { template: '<div />' } }, { path: '/:p(.*)*', component: { template: '<div />' } }] });
  router.push({ path, query });
  await router.isReady();
  const wrapper = mount(component, { global: { plugins: [router], config: { warnHandler: (m) => warnings.push(m) } }, attachTo: document.body });
  return { wrapper, warnings, router };
}

beforeEach(() => {
  calls.length = 0;
  overrides = {};
  toasts.length = 0;
  setSession('token', { id: 'u1', full_name: 'Admin', role: 'admin' });
  installFetch();
  document.body.innerHTML = '';
});
afterEach(() => vi.restoreAllMocks());

const text = (w) => w.text().replace(/\s+/g, ' ');
const bodyText = () => document.body.textContent.replace(/\s+/g, ' ');
const button = (w, label) => w.findAll('button').find((b) => b.text().includes(label));
const bodyButton = (label) => [...document.body.querySelectorAll('button')].find((b) => b.textContent.trim().includes(label));
/** A button inside the topmost open dialog (so it never clicks a same-named button on the page behind it). */
const modalButton = (label) => {
  const modals = document.body.querySelectorAll('.modal');
  return [...modals[modals.length - 1].querySelectorAll('footer button')].find((b) => b.textContent.trim().includes(label));
};
const until = (fn, timeout = 6000) => vi.waitFor(fn, { timeout, interval: 40 });
const setValue = (el, value) => { el.value = value; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); };

async function bootPanel() {
  const r = await render(Dashboard);
  await until(() => expect(text(r.wrapper)).toContain('Net income'));
  return r;
}

describe('Control Panel', () => {
  it('shows a "pulling resources" progress bar and skeletons first, then the bento tiles', async () => {
    const { wrapper, warnings } = await render(Dashboard);
    expect(text(wrapper)).toContain('Control Panel');
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(true);
    expect(text(wrapper)).toContain('Pulling resources');
    expect(wrapper.html()).toContain('aria-busy'); // skeleton while loading

    await until(() => expect(text(wrapper)).toContain('Net income'));
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false); // gone once it hit 100%

    const t = text(wrapper);
    for (const part of ['Rent collected', 'Maintenance spend', 'Pending', 'Overdue', 'Occupancy', 'Deposits', 'Houses by type', '6 total units', 'Prices', 'Payments', 'KES 21,800']) {
      expect(t).toContain(part);
    }
    for (const label of ['Single', 'Bedsitter', 'Studio', '1 bedroom', '2 bedroom']) expect(t).toContain(label);
    for (const gone of ['Leases expiring', 'Live updates on', 'Repairs']) expect(t).not.toContain(gone);
    expect(warnings).toEqual([]);
  });

  it('replaces the date field with a calendar button, and has property buttons with a + to add one', async () => {
    const { wrapper } = await bootPanel();
    expect(wrapper.find('input[type="month"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="Choose a date"]').exists()).toBe(true);
    const chips = wrapper.findAll('.chip').map((c) => c.text());
    expect(chips.some((c) => c.includes('All properties'))).toBe(true);
    expect(chips.some((c) => c.includes('Sunrise Apartments'))).toBe(true);
    expect(chips.some((c) => c.includes('Jade Court'))).toBe(true);
    expect(wrapper.find('button[aria-label="Add property"]').exists()).toBe(true);
  });

  it('switches to a single property with skeletons while updating', async () => {
    const { wrapper } = await bootPanel();
    await wrapper.findAll('.chip').find((c) => c.text().includes('Sunrise Apartments')).trigger('click');
    expect(wrapper.html()).toContain('aria-busy'); // skeleton during the update
    await until(() => expect(text(wrapper)).toContain('Net income'));
    expect(calls.some((c) => c.url.includes(`/dashboard/summary?property_id=${sunrise.id}`))).toBe(true);
    expect(text(wrapper)).toContain('Sunrise Apartments');
    expect(text(wrapper)).toContain('Edit prices');
    expect(text(wrapper)).toContain('Bedsitter');
    expect(wrapper.find('.chip.active').text()).toContain('Sunrise Apartments');
  });

  it('shows the system as it was on an earlier day, read-only, up to 2 weeks back', async () => {
    const { wrapper } = await bootPanel();
    expect(button(wrapper, 'Update')).toBeTruthy(); // editable today

    await wrapper.find('button[aria-label="Choose a date"]').trigger('click');
    expect(wrapper.find('.cal-pop').exists()).toBe(true);

    const findDay = (date) => wrapper.find(`.cal-day[aria-label="${date}"]`);
    const goBackTo = async (date) => {
      for (let i = 0; i < 3 && !findDay(date).exists(); i++) await wrapper.find('button[aria-label="Previous month"]').trigger('click');
      for (let i = 0; i < 3 && !findDay(date).exists(); i++) await wrapper.find('button[aria-label="Next month"]').trigger('click');
      return findDay(date);
    };

    const earliest = f.summary.earliest;
    const dayBefore = new Date(`${earliest}T00:00:00`);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const before = await goBackTo(dayBefore.toLocaleDateString('en-CA'));
    if (before.exists()) expect(before.attributes('disabled')).toBeDefined(); // older than 2 weeks: not selectable
    expect((await goBackTo(f.past.date)).attributes('disabled')).toBeUndefined();

    await (await goBackTo(f.past.date)).trigger('click');
    await until(() => expect(text(wrapper)).toContain('as it was on'));
    expect(calls.some((c) => c.url.includes(`date=${f.past.date}`))).toBe(true);
    expect(button(wrapper, 'Back to today')).toBeTruthy();
    expect(button(wrapper, 'Update')).toBeFalsy(); // cannot edit history
    expect(wrapper.html()).not.toContain('Edit prices');

    await button(wrapper, 'Back to today').trigger('click');
    await until(() => expect(text(wrapper)).not.toContain('as it was on'));
  });

  it('adds a property from the + button', async () => {
    overrides['POST /api/properties'] = () => ({ status: 201, data: { id: 'new-prop', name: 'Palm Court' } });
    const { wrapper } = await bootPanel();
    await wrapper.find('button[aria-label="Add property"]').trigger('click');
    expect(bodyText()).toContain('Add property');
    const inputs = document.body.querySelectorAll('.modal input');
    setValue(inputs[0], 'Palm Court');
    setValue(inputs[1], 'Beach Road');
    bodyButton('Save property').click();
    await flushPromises();
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/properties')).body).toMatchObject({ name: 'Palm Court', address: 'Beach Road' });
    expect(toasts.some((t) => t.type === 'success')).toBe(true);
  });

  it('refresh and maintenance updates show skeletons and recalculate', async () => {
    const { wrapper } = await bootPanel();
    const before = calls.filter((c) => c.url.includes('/dashboard/summary')).length;
    await button(wrapper, 'Refresh').trigger('click');
    expect(wrapper.html()).toContain('aria-busy');
    await until(() => expect(text(wrapper)).toContain('Net income'));
    expect(calls.filter((c) => c.url.includes('/dashboard/summary')).length).toBe(before + 1);

    overrides['PUT /api/dashboard/maintenance-spend'] = () => ({ month: '2026-11', amount: '2000.00' });
    await button(wrapper, 'Update').trigger('click');
    setValue(document.body.querySelector('.modal input[inputmode="decimal"]'), '2000');
    bodyButton('Save').click();
    await flushPromises();
    expect(calls.find((c) => c.method === 'PUT').body).toMatchObject({ amount: '2000' });
  });

  it('edits prices per property and applies them to vacant houses', async () => {
    overrides['PUT /api/properties/' + sunrise.id + '/pricing'] = () => ({ rules: 5, updated_units: 2 });
    const { wrapper } = await bootPanel();
    await wrapper.findAll('.chip').find((c) => c.text().includes('Sunrise Apartments')).trigger('click');
    await until(() => expect(text(wrapper)).toContain('Edit prices'));
    await button(wrapper, 'Edit prices').trigger('click');
    expect(bodyText()).toContain('Prices: Sunrise Apartments');
    expect(bodyText()).toContain('Floor-specific prices');
    expect([...document.body.querySelectorAll('.modal input')].some((i) => i.value === '8000')).toBe(true); // bedsitter price prefilled
    bodyButton('Save prices').click();
    await flushPromises();
    const put = calls.find((c) => c.method === 'PUT' && c.url.endsWith('/pricing'));
    expect(put.body.apply_to_vacant).toBe(true);
    expect(put.body.rules).toEqual(expect.arrayContaining([
      { unit_type: 'bedsitter', floor_number: null, monthly_rent: '8000' },
      { unit_type: '2_bedroom', floor_number: 3, monthly_rent: '25000' },
    ]));
  });

  it('shows a friendly message when the server cannot be reached', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const { wrapper } = await render(Dashboard);
    await until(() => expect(text(wrapper)).toContain('We could not load the Control Panel'));
    expect(toasts[0].message).toMatch(/can't reach the server/i);
  });
});

describe('Units', () => {
  it('shows vacancy indicators, deposits, house types and tabs', async () => {
    const { wrapper, warnings } = await render(Units);
    expect(wrapper.html()).toContain('aria-busy');
    await flushPromises();
    const t = text(wrapper);
    expect(t).toContain('All6');
    expect(t).toContain('Occupied3');
    expect(t).toContain('Vacant3');
    expect(wrapper.findAll('.pill-vacant').length).toBe(3);
    expect(wrapper.findAll('.pill-occupied').length).toBe(3);
    expect(t).toContain('Deposit');
    expect(t).toContain('KES 6,500'); // Jane's deposit
    expect(wrapper.findAll('.pill-paid').length).toBeGreaterThan(0);
    expect(wrapper.findAll('.pill-pending').length).toBeGreaterThan(0);
    for (const label of ['2 bedroom', 'Studio', 'Bedsitter', '1 bedroom']) expect(t).toContain(label);
    expect(wrapper.findAll('button').filter((b) => b.text().includes('Vacate')).length).toBe(3);
    expect(wrapper.findAll('button').filter((b) => b.text().includes('Add tenant')).length).toBe(3);
    expect(warnings).toEqual([]);

    await wrapper.findAll('.seg button')[2].trigger('click');
    expect(wrapper.findAll('.pill-vacant').length).toBe(3);
  });

  it('labels every cell so tables read well as cards on phones', async () => {
    const { wrapper } = await render(Units);
    await flushPromises();
    const table = wrapper.findAll('table.stack')[1];
    const cells = table.findAll('tbody tr:first-child td').filter((td) => !td.classes().includes('cell-actions'));
    expect(cells.length).toBeGreaterThan(8);
    for (const td of cells) expect(td.attributes('data-label')).toBeTruthy();
  });

  it('adds a house with a type dropdown and rent that fills in from the price list', async () => {
    overrides['POST /api/units'] = () => ({ status: 201, data: { id: 'u-new', property_id: sunrise.id, unit_type: 'bedsitter', monthly_rent: '8000.00' } });
    const { wrapper } = await render(Units);
    await flushPromises();
    await wrapper.findAll('.page-head button').find((b) => b.text() === 'House').trigger('click');
    await flushPromises();
    expect(bodyText()).toContain('Add house');

    const selects = document.body.querySelectorAll('.modal select');
    const [propertySelect, typeSelect] = selects;
    expect(typeSelect.options.length).toBe(7); // all house types in the dropdown
    expect([...typeSelect.options].map((o) => o.textContent)).toEqual(['Single', 'Bedsitter', 'Studio', '1 bedroom', '2 bedroom', '3 bedroom', '4 bedroom']);

    const rent = () => document.body.querySelector('.modal input[inputmode="decimal"]');
    const floor = document.body.querySelector('.modal input[type="number"]');
    setValue(propertySelect, sunrise.id);
    setValue(typeSelect, '2_bedroom');
    setValue(floor, '3');
    await flushPromises();
    expect(rent().value).toBe('25000'); // floor-3 price wins
    setValue(floor, '1');
    await flushPromises();
    expect(rent().value).toBe('20000'); // all-floors price
    setValue(typeSelect, 'bedsitter');
    await flushPromises();
    expect(rent().value).toBe('8000');
    expect(bodyText()).toContain('Price list: KES 8,000');

    setValue(document.body.querySelectorAll('.modal input')[1], 'C9');
    modalButton('Save house').click();
    await flushPromises();
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/units'));
    expect(post.body).toMatchObject({ property_id: sunrise.id, unit_number: 'C9', unit_type: 'bedsitter', monthly_rent: '8000' });
  });

  it('vacates a house after confirmation', async () => {
    const occupied = f.units.find((u) => u.status === 'occupied');
    overrides[`POST /api/units/${occupied.id}/vacate`] = () => ({ unit_number: occupied.unit_number, tenant_name: occupied.tenant_name, purge_at: '2026-12-26T10:00:00Z', outstanding_balance: '5000.00' });
    const { wrapper } = await render(Units);
    await flushPromises();
    await wrapper.findAll('button').filter((b) => b.text().includes('Vacate'))[0].trigger('click');
    expect(bodyText()).toContain('permanently deleted after 60 days');
    bodyButton('Yes, vacate').click();
    await flushPromises();
    expect(toasts[0].message).toContain('now vacant');
    expect(toasts[0].message).toContain('Archives');
  });
});

describe('Tenants', () => {
  it('shows rent status, deposit, date added, and greys out reminders when paid', async () => {
    const { wrapper, warnings } = await render(Tenants);
    expect(wrapper.html()).toContain('aria-busy');
    await flushPromises();
    expect(wrapper.findAll('th').map((h) => h.text())).toEqual(expect.arrayContaining(['Tenant', 'House', 'Rent status', 'Deposit', 'Date added']));

    const reminders = wrapper.findAll('button').filter((b) => b.text().includes('Send reminder'));
    expect(reminders.length).toBe(3);
    const rows = wrapper.findAll('tbody tr');
    for (const row of rows) {
      const paid = row.find('.pill-paid').exists() && row.text().toLowerCase().includes('paid') && !row.text().includes('Balance');
      const btn = row.findAll('button').find((b) => b.text().includes('Send reminder'));
      if (row.text().includes('Grace')) expect(btn.attributes('disabled')).toBeDefined(); // fully paid
      if (row.text().includes('Peter')) expect(btn.attributes('disabled')).toBeUndefined(); // overdue
      void paid;
    }
    expect(text(wrapper)).toContain('KES 8,000'); // Peter's pending deposit
    expect(warnings).toEqual([]);

    const peter = f.tenants.find((t) => t.full_name === 'Peter Otieno');
    overrides[`POST /api/tenants/${peter.id}/remind`] = () => ({ delivered: false, message: 'Reminder saved, but it could not be delivered: SMS is not set up yet.' });
    await rows.find((r) => r.text().includes('Peter')).findAll('button').find((b) => b.text().includes('Send reminder')).trigger('click');
    await flushPromises();
    expect(toasts[0].type).toBe('warn');
  });

  it('adds a tenant: property from the card, 7 house types, any phone format, deposit paid or not, email greyed out until entered', async () => {
    overrides['POST /api/tenants'] = () => ({ status: 201, data: { id: 't9', full_name: 'New Person', unit_number: 'B3' } });
    const { wrapper } = await render(Tenants);
    await flushPromises();
    await button(wrapper, 'Add tenant').trigger('click');
    await flushPromises();

    const modal = () => document.body.querySelector('.modal');
    const select = (label) => [...modal().querySelectorAll('label.field')].find((l) => l.textContent.trim().startsWith(label))?.querySelector('select');
    const input = (label) => [...modal().querySelectorAll('label.field')].find((l) => l.textContent.trim().startsWith(label))?.querySelector('input');

    expect([...select('Property').options].map((o) => o.textContent)).toEqual(expect.arrayContaining(['Sunrise Apartments', 'Jade Court']));
    expect(select('House type').options.length).toBe(7);

    // choose a property directly on the card: houses and rent follow
    setValue(select('Property'), sunrise.id);
    await flushPromises();
    expect(select('House').options.length).toBeGreaterThan(0);
    expect(input('Monthly rent').value).toBe('9500'); // vacant studio
    setValue(select('House type'), '2_bedroom'); // rent follows the price list for the type
    await flushPromises();
    expect(input('Monthly rent').value).toBe('20000');

    // email option is greyed out until an email is typed
    const emailOption = () => [...select('Send reminders by').options].find((o) => o.value === 'email');
    expect(emailOption().disabled).toBe(true);
    expect(emailOption().textContent).toContain('enter an email');
    setValue(input('Email'), 'new@example.com');
    await flushPromises();
    expect(emailOption().disabled).toBe(false);
    setValue(select('Send reminders by'), 'email');
    setValue(input('Email'), '');
    await flushPromises();
    expect(emailOption().disabled).toBe(true);
    expect(select('Send reminders by').value).toBe('sms'); // falls back when the email is removed

    setValue(input('Full name'), 'New Person');
    setValue(input('Phone number'), '0112 345 678'); // 01 numbers are fine
    setValue(input('ID number'), '31000001');
    setValue(input('Deposit amount'), '5000');
    [...modal().querySelectorAll('.seg button')].find((b) => b.textContent.trim() === 'Paid').click();
    await flushPromises();
    modalButton('Add tenant').click();
    await flushPromises();

    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/tenants'));
    expect(post.body).toMatchObject({
      full_name: 'New Person', phone: '0112 345 678', unit_type: '2_bedroom', rent_amount: '20000',
      deposit_amount: '5000', deposit_paid: true, preferred_channel: 'sms',
    });
    expect(post.body.unit_id).toBeTruthy();
    expect(toasts.some((t) => t.type === 'success')).toBe(true);
  });

  it('offers an Add house button when no house is available, and selects the new house', async () => {
    let vacant = [];
    overrides['GET /api/units/overview'] = (path) => (path.includes('status=vacant') ? vacant : f.units);
    overrides['POST /api/units'] = () => {
      vacant = [{ id: 'u-new', property_id: sunrise.id, unit_number: 'Z1', floor_number: 1, unit_type: '2_bedroom', monthly_rent: '20000.00', status: 'vacant' }];
      return { status: 201, data: { id: 'u-new', property_id: sunrise.id, unit_number: 'Z1', unit_type: '2_bedroom', monthly_rent: '20000.00' } };
    };
    const { wrapper } = await render(Tenants);
    await flushPromises();
    await button(wrapper, 'Add tenant').trigger('click');
    await flushPromises();

    expect(bodyText()).toContain('no vacant house');
    const addHouse = [...document.body.querySelectorAll('.banner button')].find((b) => b.textContent.includes('Add house'));
    expect(addHouse).toBeTruthy();
    addHouse.click();
    await flushPromises();
    expect(bodyText()).toContain('Add house'); // the house window opened on top

    const modals = document.body.querySelectorAll('.modal');
    const houseModal = modals[modals.length - 1];
    const fields = houseModal.querySelectorAll('input');
    setValue(houseModal.querySelectorAll('select')[0], sunrise.id);
    setValue(houseModal.querySelectorAll('select')[1], '2_bedroom');
    setValue(fields[0], '1'); // floor
    setValue(fields[1], 'Z1');
    await flushPromises();
    [...houseModal.querySelectorAll('footer button')].find((b) => b.textContent.includes('Save house')).click();
    await flushPromises();

    const select = [...document.body.querySelectorAll('.modal label.field')].find((l) => l.textContent.trim().startsWith('House') && !l.textContent.includes('type')).querySelector('select');
    expect(select.value).toBe('u-new'); // the new house is already picked
  });

  it('edits deposit status and keeps email reminders greyed out without an email', async () => {
    const jane = f.tenants.find((t) => t.full_name === 'Jane Mwangi');
    overrides[`PATCH /api/tenants/${jane.id}`] = () => ({ id: jane.id });
    const { wrapper } = await render(Tenants);
    await flushPromises();
    await wrapper.findAll('tbody tr').find((r) => r.text().includes('Jane')).find('button[aria-label="Edit tenant"]').trigger('click');
    expect(bodyText()).toContain('Edit Jane Mwangi');
    const emailOpt = [...document.body.querySelectorAll('.modal option')].find((o) => o.value === 'email');
    expect(emailOpt.disabled).toBe(true);
    [...document.body.querySelectorAll('.modal .seg button')].find((b) => b.textContent.includes('Not yet')).click();
    modalButton('Save changes').click();
    await flushPromises();
    expect(calls.find((c) => c.method === 'PATCH').body).toMatchObject({ deposit_paid: false, deposit_amount: '6500' });
  });
});

describe('Broadcast', () => {
  it('filters by house type, floor, rent status and deposit, and can pick specific tenants', async () => {
    const { wrapper, warnings } = await render(Broadcast);
    await flushPromises();
    const selects = wrapper.findAll('select');
    const typeSelect = selects.find((s) => s.text().includes('All types'));
    expect(typeSelect.findAll('option').length).toBe(8); // all + 7 house types
    expect(typeSelect.text()).toContain('2 bedroom');
    expect(typeSelect.text()).toContain('Studio');
    expect(selects.some((s) => s.text().includes('Pending') && s.text().includes('Any'))).toBe(true); // deposit filter
    expect(text(wrapper)).toContain('3 tenants will receive this');

    await typeSelect.setValue('2_bedroom');
    await new Promise((r) => setTimeout(r, 350));
    expect(calls.some((c) => c.url.endsWith('/broadcast/preview') && c.body.filters.unit_type === '2_bedroom')).toBe(true);

    await wrapper.findAll('.seg button').find((b) => b.text() === 'Pick tenants').trigger('click');
    const boxes = wrapper.findAll('input[type="checkbox"]');
    expect(boxes.length).toBe(3);
    expect(text(wrapper)).toContain('0 tenants will receive this');
    await boxes[0].setValue(true);
    await boxes[2].setValue(true);
    expect(text(wrapper)).toContain('2 tenants will receive this');
    expect(text(wrapper)).toContain('2 hand-picked tenants');

    await wrapper.find('textarea').setValue('Hello {name}');
    overrides['POST /api/broadcast/send'] = () => ({ total: 2, sent: 2, failed: 0, failures: [] });
    await button(wrapper, 'Review and send').trigger('click');
    bodyButton('Send now').click();
    await flushPromises();
    const sent = calls.find((c) => c.url.endsWith('/broadcast/send'));
    expect(sent.body.tenant_ids.length).toBe(2);
    expect(sent.body.filters).toEqual({ unit_type: '2_bedroom' });
    expect(toasts[0].message).toContain('sent to 2 tenants');
    expect(warnings).toEqual([]);
  });
});

describe('Archives and Logs', () => {
  it('lists archived tenants with deposit info and a deletion countdown', async () => {
    const { wrapper, warnings } = await render(Archives);
    await flushPromises();
    const t = text(wrapper);
    expect(t).toContain('Mary Achieng');
    expect(t).toContain('60 days');
    expect(t).toContain('refund may be due');
    expect(warnings).toEqual([]);
  });

  it('shows categorised logs and filters by category', async () => {
    const { wrapper, warnings } = await render(Logs);
    await flushPromises();
    expect(wrapper.findAll('.log').length).toBe(f.logs.items.length);
    await wrapper.findAll('.seg button').find((b) => b.text() === 'M-Pesa').trigger('click');
    await new Promise((r) => setTimeout(r, 350));
    expect(calls.some((c) => c.url.includes('category=mpesa'))).toBe(true);
    expect(warnings).toEqual([]);
  });
});

describe('Sign in and tenant payment page', () => {
  it('shows the calligraphy title, a real estate quote, and a password peek button', async () => {
    setSession(null, null);
    const { wrapper } = await render(Login);
    expect(wrapper.find('h1.script-title').text()).toBe('My Property Management System');
    const quote = wrapper.find('.quote');
    expect(QUOTES.some((q) => quote.text().includes(q.text) && quote.text().includes(q.by))).toBe(true);

    const input = wrapper.find('input[autocomplete="current-password"]');
    expect(input.attributes('type')).toBe('password');
    const eye = wrapper.find('button.eye');
    expect(eye.attributes('aria-label')).toBe('Show password');
    await eye.trigger('click');
    expect(input.attributes('type')).toBe('text');
    expect(eye.attributes('aria-label')).toBe('Hide password');
    await eye.trigger('click');
    expect(input.attributes('type')).toBe('password');
  });

  it('shows a friendly sign-in error', async () => {
    setSession(null, null);
    overrides['POST /api/auth/login'] = () => ({ status: 401, data: { message: 'That email or password is not right. Please try again.' } });
    const { wrapper } = await render(Login);
    await wrapper.find('input[type="email"]').setValue('a@b.com');
    await wrapper.find('input[autocomplete="current-password"]').setValue('wrong');
    await button(wrapper, 'Sign in').trigger('click');
    await flushPromises();
    expect(text(wrapper)).toContain('not right');
  });

  it('walks a tenant from QR scan to a paid receipt', async () => {
    overrides['POST /api/public/verify'] = () => ({ token: 'pay-token', tenant_name: 'Jane', unit_number: 'A1' });
    overrides['GET /api/public/invoice'] = () => ({
      invoice: { id: 'inv1', invoice_number: 'INV-1', billing_period: '2026-10-01', due_date: '2026-10-05', amount_due: '15000.00', amount_paid: '5000.00', balance: '10000.00', status: 'overdue', unit_number: 'A1' },
    });
    overrides['POST /api/public/pay/mpesa'] = () => ({ status: 201, data: { transaction_id: 5, message: 'ok' } });
    overrides['GET /api/public/pay/status/5'] = () => ({ status: 'success', amount: '10000.00', receipt_number: 'RCP-2026-000005-ABC123', balance: '0.00' });

    const { wrapper, warnings } = await render(Pay, { path: '/p/sunrise-apartments' });
    expect(wrapper.html()).toContain('aria-busy');
    await flushPromises();
    await wrapper.find('select').setValue(f.publicUnits.units[0].id);
    await button(wrapper, 'Continue').trigger('click');
    await button(wrapper, 'Find my rent').trigger('click');
    expect(text(wrapper)).toContain('Please enter the full phone number');
    await wrapper.find('input').setValue('0112 345 678'); // 01 numbers work too
    await button(wrapper, 'Find my rent').trigger('click');
    await flushPromises();
    expect(text(wrapper)).toContain('KES 10,000');
    await button(wrapper, 'Pay KES 10,000').trigger('click');
    await flushPromises();
    expect(calls.find((c) => c.url.endsWith('/pay/mpesa')).body).toMatchObject({ invoice_id: 'inv1', amount: 10000 });
    expect(text(wrapper)).toContain('Payment received');
    expect(wrapper.find('a[href*="/api/public/receipts/RCP-2026-000005-ABC123"]').exists()).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('shows a friendly message for an unknown property', async () => {
    overrides['GET /api/public/properties/sunrise-apartments/units'] = () => ({ status: 404, data: { message: 'We could not find what you were looking for.' } });
    const { wrapper } = await render(Pay, { path: '/p/sunrise-apartments' });
    await flushPromises();
    expect(text(wrapper)).toContain('This page is not available');
  });
});
