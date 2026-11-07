<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import AddPropertyModal from '../components/AddPropertyModal.vue';
import AddUnitModal from '../components/AddUnitModal.vue';
import DatePopover from '../components/DatePopover.vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import PricingModal from '../components/PricingModal.vue';
import Skeleton from '../components/Skeleton.vue';
import { ago, api, canManage, initials, kes } from '../api.js';
import { HOUSE_TYPES, typeLabel } from '../houseTypes.js';
import { live } from '../live.js';
import { notify } from '../toast.js';

const localDay = (d) => d.toLocaleDateString('en-CA');
const todayLocal = localDay(new Date());
const earliestLocal = localDay(new Date(Date.now() - 14 * 86400000));

const properties = ref([]);
const pricing = ref([]);
const summary = ref(null);
const feed = ref([]);
const fresh = ref(new Set());
const propertyId = ref('');
const asOf = ref(null);
const failed = ref(false);

const booted = ref(false);
const reloading = ref(false);
const refreshing = ref(false);
const now = ref(Date.now());
let clock;

/* ---------- first-load progress bar ("pulling resources") ---------- */
const progress = reactive({ target: 0, shown: 0 });
let ticker = null;
let tasksFinished = false;

function startProgress() {
  progress.target = 10;
  ticker = setInterval(() => {
    if (!tasksFinished && progress.target < 88 && progress.shown >= progress.target - 1) progress.target += 2; // keep creeping while waiting
    progress.shown = Math.min(progress.target, progress.shown + Math.max(1.2, (progress.target - progress.shown) * 0.16));
    if (tasksFinished && progress.shown >= 99.5) {
      progress.shown = 100;
      clearInterval(ticker);
      ticker = null;
      setTimeout(() => { booted.value = true; }, 350);
    }
  }, 40);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const query = (extra = '') => {
  const p = new URLSearchParams();
  if (propertyId.value) p.set('property_id', propertyId.value);
  if (asOf.value) p.set('date', asOf.value);
  return `${p.toString()}${extra}`;
};

const fetchProperties = async () => { properties.value = await api('/properties'); };
const fetchPricing = async () => { pricing.value = await api('/pricing'); };
const fetchSummary = async () => { summary.value = await api(`/dashboard/summary?${query()}`); };
async function fetchFeed() {
  const rows = await api(`/dashboard/live?${query('&limit=15')}`);
  const known = new Set(feed.value.map((x) => x.id));
  fresh.value = new Set(known.size ? rows.filter((x) => !known.has(x.id)).map((x) => x.id) : []);
  feed.value = rows;
}

async function boot() {
  startProgress();
  const tasks = [fetchProperties, fetchPricing, fetchSummary, fetchFeed];
  let done = 0;
  let firstError = null;
  await Promise.all(tasks.map(async (t) => {
    try { await t(); } catch (e) { firstError ??= e; } finally {
      done++;
      progress.target = Math.max(progress.target, Math.round((done / tasks.length) * 100));
    }
  }));
  if (firstError) { notify.error(firstError.message); failed.value = !summary.value; }
  progress.target = 100;
  tasksFinished = true;
}

/** Reload after a user action: show skeletons so the update is visible. */
async function reload({ manual = false } = {}) {
  reloading.value = true;
  refreshing.value = manual;
  failed.value = false;
  try {
    await Promise.all([fetchSummary(), fetchFeed(), sleep(350)]);
    if (manual) notify.success('Control Panel is up to date.');
  } catch (e) {
    notify.error(e.message);
    failed.value = !summary.value;
  } finally {
    reloading.value = false;
    refreshing.value = false;
  }
}

onMounted(() => {
  boot();
  clock = setInterval(() => (now.value = Date.now()), 30000);
});
onBeforeUnmount(() => { clearInterval(clock); clearInterval(ticker); });

// New payments arriving live refresh the numbers quietly (today's view only).
watch(() => live.tick, async () => {
  if (!booted.value || asOf.value) return;
  try { await Promise.all([fetchSummary(), fetchFeed()]); } catch { /* next refresh will retry */ }
});

const selectProperty = (id) => { if (propertyId.value !== id) { propertyId.value = id; reload(); } };
const setDate = (d) => { asOf.value = d; reload(); };

const ready = computed(() => booted.value && !reloading.value && summary.value);
const pastView = computed(() => Boolean(asOf.value));
const activeProperty = computed(() => properties.value.find((p) => p.id === propertyId.value));
const scopeLabel = computed(() => activeProperty.value?.name ?? 'All properties');
const dateLabel = computed(() =>
  new Date(`${(asOf.value ?? todayLocal)}T00:00:00`).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
const monthLabel = computed(() =>
  summary.value ? new Date(`${summary.value.month}-01T00:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }) : '');

const bars = computed(() => {
  const rows = summary.value?.revenue_trend ?? [];
  const max = Math.max(1, ...rows.map((r) => Number(r.collected)));
  return rows.map((r) => ({
    label: new Date(`${r.month}-01T00:00:00`).toLocaleDateString('en-KE', { month: 'short' }),
    gross: (Number(r.collected) / max) * 100,
    net: (Math.max(Number(r.net), 0) / max) * 100,
    title: `${kes(r.collected)} collected - ${kes(r.spent)} maintenance = ${kes(r.net)}`,
  }));
});
const blocks = computed(() => Math.round((summary.value?.occupancy_pct ?? 0) / 10));

const typeRows = computed(() =>
  (summary.value?.by_type ?? []).map((t) => ({
    ...t,
    label: typeLabel(t.unit_type),
    occPct: t.total ? (t.occupied / t.total) * 100 : 0,
    vacPct: t.total ? (t.vacant / t.total) * 100 : 0,
    range: Number(t.min_rent) === Number(t.max_rent) ? kes(t.min_rent) : `${kes(t.min_rent)} - ${kes(t.max_rent)}`,
  })));

/* prices shown for the selected property (or one row per property in the global view) */
const rulesFor = (id) => pricing.value.filter((r) => r.property_id === id);
const priceRows = computed(() => {
  if (!activeProperty.value) return [];
  const rules = rulesFor(activeProperty.value.id);
  return HOUSE_TYPES.map((t) => ({
    label: t.label,
    general: rules.find((r) => r.unit_type === t.value && r.floor_number === null)?.monthly_rent ?? null,
    floors: rules.filter((r) => r.unit_type === t.value && r.floor_number !== null),
  })).filter((r) => r.general !== null || r.floors.length);
});

/* ---------- dialogs ---------- */
const showAddProperty = ref(false);
const showAddUnit = ref(false);
const pricingFor = ref(null);

async function propertySaved(p) {
  showAddProperty.value = false;
  try { await fetchProperties(); } catch (e) { notify.error(e.message); }
  selectProperty(p.id);
}
async function unitSaved() {
  showAddUnit.value = false;
  try { await fetchProperties(); } catch { /* chip counts refresh next time */ }
  reload();
}
async function pricesSaved() {
  pricingFor.value = null;
  try { await fetchPricing(); } catch (e) { notify.error(e.message); }
  reload();
}

const spendOpen = ref(false);
const spend = reactive({ property_id: '', amount: '', note: '' });
const spendError = ref('');
const saving = ref(false);

function openSpend() {
  const list = summary.value.maintenance_properties;
  const first = list.find((p) => p.id === propertyId.value) ?? list[0];
  if (!first) { notify.info('Add a property first, then you can record maintenance spend.'); return; }
  Object.assign(spend, { property_id: first.id, amount: first.amount, note: first.note ?? '' });
  spendError.value = '';
  spendOpen.value = true;
}
function pickSpendProperty() {
  const p = summary.value.maintenance_properties.find((x) => x.id === spend.property_id);
  Object.assign(spend, { amount: p?.amount ?? '', note: p?.note ?? '' });
}
async function saveSpend() {
  if (String(spend.amount).trim() === '') { spendError.value = 'Please enter an amount (use 0 if nothing was spent).'; return; }
  saving.value = true;
  spendError.value = '';
  try {
    await api('/dashboard/maintenance-spend', {
      method: 'PUT',
      body: { property_id: spend.property_id, month: summary.value.month, amount: String(spend.amount), note: spend.note || undefined },
    });
    spendOpen.value = false;
    notify.success('Maintenance spend updated. Net income has been recalculated.');
    reload();
  } catch (e) {
    spendError.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <header class="page-head">
    <div class="title-row">
      <div>
        <h1>Control Panel</h1>
        <p class="sub">{{ scopeLabel }} &middot; {{ dateLabel }}</p>
      </div>
      <div v-if="!booted" class="bootbar" role="progressbar" aria-label="Pulling resources" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.floor(progress.shown)">
        <span>Pulling resources</span>
        <div class="track"><i :style="{ width: progress.shown + '%' }" /></div>
        <b>{{ Math.floor(progress.shown) }}%</b>
      </div>
    </div>
    <div class="actions">
      <DatePopover :model-value="asOf" :min="summary?.earliest ?? earliestLocal" :max="summary?.today ?? todayLocal" :disabled="!booted" @update:model-value="setDate" />
      <button class="btn" :class="{ spinning: refreshing }" :disabled="!booted" @click="reload({ manual: true })"><Icon name="refresh" :size="18" />Refresh</button>
    </div>
  </header>

  <section class="card" style="padding: 16px 20px" aria-label="Properties">
    <div class="chips">
      <button class="chip" :class="{ active: !propertyId }" :disabled="!booted" @click="selectProperty('')"><Icon name="home" :size="16" />All properties</button>
      <button v-for="p in properties" :key="p.id" class="chip" :class="{ active: propertyId === p.id }" @click="selectProperty(p.id)">
        {{ p.name }}<small>{{ p.unit_count }}</small>
      </button>
      <button v-if="canManage() && booted" class="chip add" aria-label="Add property" title="Add property" @click="showAddProperty = true"><Icon name="plus" :size="18" /></button>
    </div>
  </section>

  <div v-if="pastView && booted" class="banner info row past-banner" role="status">
    <span>Showing {{ scopeLabel }} as it was on <strong>{{ dateLabel }}</strong>. Figures are rebuilt from payment and tenancy records, and cannot be edited.</span>
    <button class="btn sm" @click="setDate(null)">Back to today</button>
  </div>

  <div v-if="failed && !reloading && booted" class="card empty">
    <strong>We could not load the Control Panel</strong>
    Please check your connection and try again.
    <div style="margin-top: 14px"><button class="btn primary" @click="reload({ manual: true })">Try again</button></div>
  </div>

  <Skeleton v-else-if="!ready" type="bento" />

  <template v-else>
    <section class="bento">
      <div class="tile hero s5 kpi">
        <div class="label">Net income &middot; {{ monthLabel }}</div>
        <div class="value">{{ kes(summary.net_income) }}</div>
        <div class="hint">{{ kes(summary.collected) }} collected - {{ kes(summary.maintenance_spent) }} maintenance</div>
      </div>
      <div class="tile s3 kpi">
        <div class="label">Rent collected</div>
        <div class="value">{{ kes(summary.collected) }}</div>
        <div class="hint">{{ summary.paid_count }} of {{ summary.invoice_count }} tenants paid in full</div>
      </div>
      <div class="tile s4 kpi accent">
        <div class="label">
          Maintenance spend
          <button v-if="canManage() && !pastView" class="btn sm" @click="openSpend"><Icon name="edit" :size="14" />Update</button>
        </div>
        <div class="value">{{ kes(summary.maintenance_spent) }}</div>
        <div class="hint">Deducted from your net income</div>
      </div>

      <div class="tile s3 kpi">
        <div class="label">Pending</div>
        <div class="value">{{ kes(summary.pending) }}</div>
        <div class="hint">Not yet due, or part paid</div>
      </div>
      <div class="tile s3 kpi">
        <div class="label">Overdue</div>
        <div class="value" style="color: var(--cherry)">{{ kes(summary.overdue) }}</div>
        <div class="hint">Past the due date</div>
      </div>
      <div class="tile s3 kpi">
        <div class="label">Occupancy</div>
        <div class="value">{{ summary.occupancy_pct }}%</div>
        <div class="blocks" aria-hidden="true"><i v-for="n in 10" :key="n" :class="{ on: n <= blocks }" /></div>
        <div class="hint">{{ summary.occupied_units }} occupied, {{ summary.vacant_units }} vacant</div>
      </div>
      <div v-if="summary.deposits" class="tile s3 kpi">
        <div class="label">Deposits</div>
        <div class="value">{{ kes(summary.deposits.held) }}</div>
        <div class="hint">held for {{ summary.deposits.held_count }} tenant{{ summary.deposits.held_count === 1 ? '' : 's' }}<template v-if="summary.deposits.pending_count"> &middot; {{ kes(summary.deposits.pending) }} still pending</template></div>
      </div>
      <div v-else class="tile s3 kpi">
        <div class="label">Paid up</div>
        <div class="value">{{ summary.paid_count }}<small class="muted"> / {{ summary.invoice_count }}</small></div>
        <div class="hint">Tenants who had paid in full</div>
      </div>

      <div class="tile s7">
        <h2>Income, last 6 months</h2>
        <div v-if="!bars.length" class="empty">No payments recorded yet.</div>
        <template v-else>
          <div class="chart">
            <div v-for="b in bars" :key="b.label + b.gross" class="col-bar" :title="b.title">
              <div class="stack"><div class="gross" :style="{ height: b.gross + '%' }" /><div class="net" :style="{ height: b.net + '%' }" /></div>
              {{ b.label }}
            </div>
          </div>
          <div class="legend">
            <span><i style="background: var(--singapore)" />Collected</span>
            <span><i style="background: var(--cherry)" />Net after maintenance</span>
          </div>
        </template>
      </div>

      <div class="tile s5 rs2">
        <h2>Payments <span class="live-badge" :class="{ off: pastView || !live.connected }"><i class="dot" />{{ pastView ? 'History' : live.connected ? 'Live' : 'Offline' }}</span></h2>
        <p class="muted" style="margin-top: -.4rem"><small>Shows each time a tenant pays rent.</small></p>
        <div v-if="!feed.length" class="empty"><strong>No payments yet</strong>New payments will appear here the moment they arrive.</div>
        <TransitionGroup v-else name="feed" tag="div" class="feed">
          <div v-for="p in feed" :key="p.id" class="feed-item" :class="{ fresh: fresh.has(p.id) }">
            <div class="avatar">{{ initials(p.tenant_name) }}</div>
            <div class="text">
              <div><b>{{ p.tenant_name }}</b> (house {{ p.unit_number }}) paid <b>{{ kes(p.amount) }}</b></div>
              <div class="meta">{{ ago(p.paid_at, now) }} &middot; {{ p.period }} rent &middot; {{ p.method.replace('_', ' ') }}<template v-if="!activeProperty && properties.length > 1"> &middot; {{ p.property_name }}</template></div>
            </div>
            <span class="pill" :class="p.fully_paid ? 'pill-paid' : 'pill-partial'">{{ p.fully_paid ? 'Paid in full' : `Owes ${kes(p.balance)}` }}</span>
          </div>
        </TransitionGroup>
      </div>

      <div class="tile s7">
        <h2>
          Houses by type
          <button v-if="canManage() && !pastView" class="btn sm" @click="showAddUnit = true"><Icon name="plus" :size="14" />Add house</button>
        </h2>
        <div v-if="!typeRows.length" class="empty"><strong>No houses yet</strong>Add a house to start tracking occupancy.</div>
        <template v-else>
          <p style="margin-bottom: 4px"><strong style="font-size: 1.5rem">{{ summary.total_units }}</strong> <span class="muted">total unit{{ summary.total_units === 1 ? '' : 's' }}</span></p>
          <div v-for="t in typeRows" :key="t.unit_type ?? 'none'" class="type-row">
            <div><strong>{{ t.label }}</strong><small style="display: block" class="muted">{{ t.total }} house{{ t.total === 1 ? '' : 's' }}</small></div>
            <div class="bar" :title="`${t.occupied} occupied, ${t.vacant} vacant`"><i class="occ" :style="{ width: t.occPct + '%' }" /><i class="vac" :style="{ width: t.vacPct + '%' }" /></div>
            <div style="text-align: right"><strong>{{ t.occupied }}/{{ t.total }}</strong><small style="display: block" class="muted">{{ t.range }}</small></div>
          </div>
          <div class="legend"><span><i style="background: var(--cherry)" />Occupied</span><span><i style="background: var(--singapore)" />Vacant</span></div>
        </template>
      </div>

      <div class="tile s7">
        <h2><span>Prices</span></h2>
        <template v-if="activeProperty">
          <div v-if="!priceRows.length" class="empty"><strong>No prices set yet</strong>Set a price per house type once, and it fills in automatically when you add a house or tenant.</div>
          <div v-for="r in priceRows" :key="r.label" class="price-row">
            <div><strong>{{ r.label }}</strong><small v-if="r.floors.length" style="display: block" class="muted">{{ r.floors.map((f) => `Floor ${f.floor_number}: ${kes(f.monthly_rent)}`).join(' &middot; ') }}</small></div>
            <strong>{{ r.general !== null ? kes(r.general) : 'Floor prices only' }}</strong>
          </div>
          <button v-if="canManage() && !pastView" class="btn" style="margin-top: 14px" @click="pricingFor = activeProperty"><Icon name="tag" :size="16" />Edit prices</button>
        </template>
        <template v-else>
          <div v-if="!properties.length" class="empty"><strong>No properties yet</strong>Add a property to set its prices.</div>
          <div v-for="p in properties" :key="p.id" class="price-row">
            <div><strong>{{ p.name }}</strong><small style="display: block" class="muted">{{ rulesFor(p.id).length }} price{{ rulesFor(p.id).length === 1 ? '' : 's' }} set</small></div>
            <button v-if="canManage() && !pastView" class="btn sm" @click="pricingFor = p"><Icon name="tag" :size="15" />Edit prices</button>
          </div>
        </template>
      </div>

      <div class="tile s5">
        <h2>Overdue rent by age</h2>
        <div class="ageing"><span>1 to 7 days</span><strong>{{ kes(summary.arrears_ageing.d0_7) }}</strong></div>
        <div class="ageing"><span>8 to 30 days</span><strong>{{ kes(summary.arrears_ageing.d8_30) }}</strong></div>
        <div class="ageing"><span>Over 30 days</span><strong>{{ kes(summary.arrears_ageing.d30_plus) }}</strong></div>
      </div>
    </section>
  </template>

  <AddPropertyModal v-if="showAddProperty" @close="showAddProperty = false" @saved="propertySaved" />
  <AddUnitModal v-if="showAddUnit" :properties="properties" :property-id="propertyId" @close="showAddUnit = false" @saved="unitSaved" @add-property="showAddUnit = false; showAddProperty = true" />
  <PricingModal v-if="pricingFor" :property="pricingFor" :rules="rulesFor(pricingFor.id)" @close="pricingFor = null" @saved="pricesSaved" />

  <Modal v-if="spendOpen" title="Update maintenance spend" @close="spendOpen = false">
    <div v-if="spendError" class="banner error" role="alert">{{ spendError }}</div>
    <p class="muted">Enter the total spent on maintenance in {{ monthLabel }}. It is deducted from rent collected to give your net income.</p>
    <label v-if="summary.maintenance_properties.length > 1" class="field">Property
      <select v-model="spend.property_id" @change="pickSpendProperty"><option v-for="p in summary.maintenance_properties" :key="p.id" :value="p.id">{{ p.name }}</option></select>
    </label>
    <label class="field">Amount spent (KES) <input v-model="spend.amount" inputmode="decimal" placeholder="0" @keyup.enter="saveSpend" /></label>
    <label class="field">Note (optional) <input v-model="spend.note" maxlength="300" placeholder="e.g. Plumber and paint" /></label>
    <footer>
      <button class="btn" @click="spendOpen = false">Cancel</button>
      <button class="btn primary" :class="{ busy: saving }" :disabled="saving" @click="saveSpend">Save</button>
    </footer>
  </Modal>
</template>
