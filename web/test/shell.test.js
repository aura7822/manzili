import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import App from '../src/App.vue';
import DatePopover from '../src/components/DatePopover.vue';
import { setSession } from '../src/api.js';
import { live, startLive, stopLive } from '../src/live.js';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');

const routes = ['/', '/units', '/tenants', '/broadcast', '/archives', '/logs'].map((path) => ({ path, component: { template: '<div>page</div>' } }));

async function renderApp(role) {
  setSession('token', { id: 'u1', full_name: 'Test User', role });
  const router = createRouter({ history: createMemoryHistory(), routes });
  router.push('/');
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
});

describe('app shell', () => {
  it('shows every section to admins under the Control Panel name, and none of the removed ones', async () => {
    const w = await renderApp('admin');
    const links = w.findAll('.rail nav a').map((a) => a.text());
    expect(links).toEqual(['Control Panel', 'Units', 'Tenants', 'Broadcast', 'Archives', 'Logs']);
    expect(w.text()).not.toContain('Live updates on');
    for (const removed of ['Leases', 'Ledger', 'Maintenance', 'Reports', 'Dashboard']) expect(links).not.toContain(removed);
    w.unmount();
  });

  it('has an auto-collapsing rail and a mobile bottom navigation', async () => {
    const w = await renderApp('admin');
    expect(w.find('aside.rail').exists()).toBe(true);
    expect(w.findAll('.rail .label').length).toBeGreaterThan(5); // labels are hidden by CSS until the rail is hovered
    expect(w.findAll('nav.bottom-nav a').length).toBe(6);
    expect(w.find('header.mobile-bar').exists()).toBe(true);
    w.unmount();
  });

  it('hides sensitive sections from caretakers', async () => {
    const w = await renderApp('caretaker');
    expect(w.findAll('.rail nav a').map((a) => a.text())).toEqual(['Control Panel', 'Units', 'Tenants']);
    w.unmount();
  });
});

describe('calendar', () => {
  const mountCal = (modelValue = null) => mount(DatePopover, { props: { modelValue, min: '2026-10-19', max: '2026-11-02' }, attachTo: document.body });

  it('allows only the last 14 days and reports the chosen day', async () => {
    const w = mountCal();
    await w.find('button[aria-label="Choose a date"]').trigger('click');
    expect(w.find('.cal-day[aria-label="2026-11-02"]').attributes('disabled')).toBeUndefined();
    expect(w.find('.cal-day[aria-label="2026-11-03"]').attributes('disabled')).toBeDefined(); // future
    await w.find('.cal-day[aria-label="2026-11-01"]').trigger('click');
    expect(w.emitted('update:modelValue')[0]).toEqual(['2026-11-01']);

    await w.find('button[aria-label="Choose a date"]').trigger('click');
    await w.find('button[aria-label="Previous month"]').trigger('click');
    expect(w.find('.cal-day[aria-label="2026-10-18"]').attributes('disabled')).toBeDefined(); // older than 2 weeks
    expect(w.find('.cal-day[aria-label="2026-10-19"]').attributes('disabled')).toBeUndefined();
    expect(w.find('button[aria-label="Previous month"]').attributes('disabled')).toBeDefined(); // nothing earlier is selectable
    w.unmount();
  });

  it('choosing today clears the date', async () => {
    const w = mountCal('2026-11-01');
    expect(w.text()).toContain('1 Nov');
    await w.find('button[aria-label="Choose a date"]').trigger('click');
    await w.find('.cal-day[aria-label="2026-11-02"]').trigger('click');
    expect(w.emitted('update:modelValue')[0]).toEqual([null]);
    w.unmount();
  });
});

describe('design rules', () => {
  it('uses sharp edges and flat colours only: no border radius, gradients or glows', () => {
    expect(css).toMatch(/border-radius:\s*0\s*!important/);
    expect(css).not.toMatch(/border-radius:\s*(?!0\b)[0-9.]+(px|rem|em|%)/);
    expect(css).not.toMatch(/(linear|radial|conic)-gradient\(/);
    expect(css).not.toMatch(/glow/i);
  });

  it('uses the Singapore, Cherry Velvet and Ocean Water palette', () => {
    for (const hex of ['#e5df94', '#c1121f', '#cae8e8']) expect(css.toLowerCase()).toContain(hex);
  });

  it('adapts for phones: bottom navigation, sheet modals and stacked tables', () => {
    expect(css).toMatch(/@media \(max-width: 860px\)[\s\S]*\.bottom-nav/);
    expect(css).toMatch(/table\.stack thead \{ display: none; \}/);
    expect(css).toContain('safe-area-inset-bottom');
  });
});

describe('live updates stream', () => {
  it('turns server-sent events into reactive ticks', async () => {
    setSession('token', { id: 'u1', full_name: 'A', role: 'admin' });
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode(': connected\n\n'));
        controller.enqueue(enc.encode('event: payment\ndata: {"tenant_name":"Jane","amo'));
        controller.enqueue(enc.encode('unt":"5000.00"}\n\n'));
      },
    });
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, body: stream }));
    const before = live.tick;
    startLive();
    await vi.waitFor(() => expect(live.tick).toBe(before + 1));
    expect(live.last).toEqual({ type: 'payment', data: { tenant_name: 'Jane', amount: '5000.00' } });
    stopLive();
  });
});
