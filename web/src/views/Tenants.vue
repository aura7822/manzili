<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AddPropertyModal from '../components/AddPropertyModal.vue';
import AddUnitModal from '../components/AddUnitModal.vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import Pill from '../components/Pill.vue';
import Skeleton from '../components/Skeleton.vue';
import { api, canManage, fmtDate, kes } from '../api.js';
import { findPrice, HOUSE_TYPES } from '../houseTypes.js';
import { live } from '../live.js';
import { notify } from '../toast.js';

const route = useRoute();
const router = useRouter();

const tenants = ref([]);
const loading = ref(true);
const q = ref('');
const status = ref('');

async function load({ silent = true } = {}) {
  if (!silent) loading.value = true;
  const qs = new URLSearchParams();
  if (q.value) qs.set('q', q.value);
  if (status.value) qs.set('status', status.value);
  try {
    tenants.value = await api(`/tenants?${qs}`);
  } catch (e) {
    notify.error(e.message);
  } finally {
    loading.value = false;
  }
}

let timer;
watch([q, status], () => { clearTimeout(timer); timer = setTimeout(() => load(), 250); });
watch(() => live.tick, () => load());

onMounted(async () => {
  await load({ silent: false });
  if (route.query.unit && canManage()) {
    await openAdd(String(route.query.unit));
    router.replace({ query: {} });
  }
});

/* ---------- reminders ---------- */
const canRemind = (t) => ['pending', 'partial', 'overdue'].includes(t.rent_status);
const remindTitle = (t) =>
  t.rent_status === 'paid' ? 'Rent is fully paid' : t.rent_status === 'none' ? 'No rent has been billed yet' : 'Send a rent reminder';
const reminding = ref('');
const hasDeposit = (t) => Number(t.deposit_amount) > 0;

async function remind(t) {
  reminding.value = t.id;
  try {
    const r = await api(`/tenants/${t.id}/remind`, { method: 'POST' });
    (r.delivered ? notify.success : notify.warn)(r.message);
  } catch (e) {
    notify.error(e.message);
  } finally {
    reminding.value = '';
  }
}

/* ---------- add tenant ---------- */
const vacant = ref([]);
const properties = ref([]);
const prices = ref([]);
const showAdd = ref(false);
const showAddUnit = ref(false);
const showAddProperty = ref(false);
const form = reactive({});
const rentTouched = ref(false);
const formError = ref('');
const saving = ref(false);

const housesHere = computed(() => vacant.value.filter((u) => u.property_id === form.property_id));
const emailOk = computed(() => Boolean(String(form.email ?? '').trim()));
watch(emailOk, (ok) => { if (!ok && form.preferred_channel === 'email') form.preferred_channel = 'sms'; });

function chooseHouse(u) {
  form.unit_id = u?.id ?? '';
  if (u) {
    form.unit_type = u.unit_type ?? form.unit_type ?? 'single';
    form.rent_amount = String(Number(u.monthly_rent));
    rentTouched.value = false;
  }
}

function onPropertyChange() { chooseHouse(housesHere.value[0]); if (!housesHere.value[0]) form.unit_id = ''; }
function onHouseChange() { chooseHouse(vacant.value.find((u) => u.id === form.unit_id)); }
function onTypeChange() {
  const unit = vacant.value.find((u) => u.id === form.unit_id);
  const price = findPrice(prices.value, form.property_id, form.unit_type, unit?.floor_number ?? 0);
  if (price !== null && !rentTouched.value) form.rent_amount = String(Number(price));
}

async function loadChoices() {
  [vacant.value, properties.value, prices.value] = await Promise.all([
    api('/units/overview?status=vacant'), api('/properties'), api('/pricing'),
  ]);
}

async function openAdd(unitId) {
  try {
    await loadChoices();
  } catch (e) {
    notify.error(e.message);
    return;
  }
  const chosen = vacant.value.find((u) => u.id === unitId) ?? vacant.value[0];
  Object.assign(form, {
    full_name: '', phone: '', national_id: '', email: '', preferred_channel: 'sms',
    property_id: chosen?.property_id ?? properties.value[0]?.id ?? '', unit_id: '', unit_type: 'single', rent_amount: '',
    deposit_amount: '', deposit_paid: false, rent_due_day: 5, start_date: new Date().toLocaleDateString('en-CA'),
  });
  chooseHouse(chosen);
  formError.value = '';
  showAdd.value = true;
}

async function houseSaved(created) {
  showAddUnit.value = false;
  try { await loadChoices(); } catch (e) { notify.error(e.message); }
  form.property_id = created.property_id;
  chooseHouse(vacant.value.find((u) => u.id === created.id) ?? { id: created.id, unit_type: created.unit_type, monthly_rent: created.monthly_rent });
}

async function propertySaved() {
  showAddProperty.value = false;
  try { await loadChoices(); } catch (e) { notify.error(e.message); }
  showAddUnit.value = true;
}

function problem() {
  if (!form.full_name.trim()) return "Please enter the tenant's full name.";
  if (!form.phone.trim()) return "Please enter the tenant's phone number.";
  if (!form.national_id.trim()) return "Please enter the tenant's ID number.";
  if (!form.unit_id) return 'Please choose a house, or add one with the Add house button.';
  if (!String(form.rent_amount).trim()) return 'Please enter the monthly rent.';
  return '';
}

async function saveTenant() {
  formError.value = problem();
  if (formError.value) return;
  saving.value = true;
  try {
    await api('/tenants', {
      method: 'POST',
      body: {
        full_name: form.full_name, phone: form.phone, national_id: form.national_id,
        email: form.email.trim() || undefined, preferred_channel: form.preferred_channel,
        unit_id: form.unit_id, unit_type: form.unit_type, rent_amount: String(form.rent_amount),
        rent_due_day: Number(form.rent_due_day) || 5, start_date: form.start_date || undefined,
        deposit_amount: String(form.deposit_amount).trim() || '0', deposit_paid: form.deposit_paid,
      },
    });
    showAdd.value = false;
    notify.success(`${form.full_name} was added to house ${vacant.value.find((u) => u.id === form.unit_id)?.unit_number ?? ''}.`);
    await load({ silent: false });
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}

/* ---------- edit tenant ---------- */
const editing = ref(null);

function openEdit(t) {
  Object.assign(form, {
    full_name: t.full_name, phone: t.phone, national_id: t.national_id, email: t.email ?? '', preferred_channel: t.preferred_channel,
    deposit_amount: Number(t.deposit_amount) > 0 ? String(Number(t.deposit_amount)) : '', deposit_paid: t.deposit_status === 'held',
  });
  editing.value = t;
  formError.value = '';
}

async function saveEdit() {
  if (!form.full_name.trim() || !form.phone.trim() || !form.national_id.trim()) { formError.value = 'Name, phone and ID number are required.'; return; }
  saving.value = true;
  try {
    await api(`/tenants/${editing.value.id}`, {
      method: 'PATCH',
      body: {
        full_name: form.full_name, phone: form.phone, national_id: form.national_id, email: form.email.trim() || null,
        preferred_channel: form.preferred_channel, deposit_amount: String(form.deposit_amount).trim() || '0', deposit_paid: form.deposit_paid,
      },
    });
    editing.value = null;
    notify.success('Tenant details updated.');
    await load({ silent: false });
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Tenants</h1>
      <p class="sub">Who lives where, whether rent and deposit are paid.</p>
    </div>
    <div v-if="canManage()" class="actions">
      <button class="btn primary" @click="openAdd()"><Icon name="plus" :size="16" />Add tenant</button>
    </div>
  </header>

  <div class="toolbar">
    <div class="search"><Icon name="search" :size="16" /><input v-model="q" placeholder="Search name, phone, ID or house" /></div>
    <select v-model="status" aria-label="Rent status">
      <option value="">All rent statuses</option>
      <option value="paid">Paid</option>
      <option value="unpaid">Not fully paid</option>
      <option value="overdue">Overdue</option>
      <option value="pending">Pending</option>
      <option value="partial">Part paid</option>
    </select>
  </div>

  <div class="card">
    <Skeleton v-if="loading" :rows="6" :cols="6" />
    <div v-else class="table-wrap">
      <table class="stack">
        <thead><tr><th>Tenant</th><th>House</th><th>Rent status</th><th>Deposit</th><th>Date added</th><th v-if="canManage()" /></tr></thead>
        <tbody>
          <tr v-for="t in tenants" :key="t.id">
            <td data-label="Tenant"><strong>{{ t.full_name }}</strong><small>{{ t.phone }}</small></td>
            <td data-label="House"><strong>{{ t.unit_number }}</strong><small>{{ t.property_name }}<template v-if="t.unit_type"> &middot; {{ t.unit_type.replace('_', ' ') }}</template></small></td>
            <td data-label="Rent status">
              <Pill :status="t.rent_status" />
              <small v-if="canRemind(t)">Balance {{ kes(t.balance) }} &middot; due {{ fmtDate(t.due_date) }}</small>
            </td>
            <td data-label="Deposit">
              <template v-if="hasDeposit(t)"><Pill :status="t.deposit_status === 'held' ? 'paid' : 'pending'" /><small>{{ kes(t.deposit_amount) }}</small></template>
              <span v-else class="muted">None</span>
            </td>
            <td data-label="Date added">{{ fmtDate(t.created_at) }}</td>
            <td v-if="canManage()" class="cell-actions">
              <div class="row-actions">
                <button class="btn sm icon-btn" aria-label="Edit tenant" title="Edit details" @click="openEdit(t)"><Icon name="edit" :size="15" /></button>
                <button class="btn sm primary" :class="{ busy: reminding === t.id }" :disabled="!canRemind(t) || reminding === t.id" :title="remindTitle(t)" @click="remind(t)">
                  <Icon name="bell" :size="15" />Send reminder
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!tenants.length">
            <td :colspan="canManage() ? 6 : 5" class="empty cell-empty">
              <template v-if="q || status"><strong>No tenants match</strong>Try clearing the search or filter.</template>
              <template v-else><strong>No tenants yet</strong>Add your first tenant to start tracking rent.</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <Modal v-if="showAdd" title="Add tenant" wide @close="showAdd = false">
    <div v-if="formError" class="banner error" role="alert">{{ formError }}</div>

    <div v-if="!properties.length" class="banner info row">
      <span>You have no properties yet.</span>
      <button class="btn sm" @click="showAddProperty = true">Add property</button>
    </div>
    <div v-else-if="!housesHere.length" class="banner info row">
      <span>There is no vacant house in this property.</span>
      <button class="btn sm" @click="showAddUnit = true"><Icon name="plus" :size="14" />Add house</button>
    </div>

    <div class="form-grid">
      <label class="field">Property
        <select v-model="form.property_id" :disabled="!properties.length" @change="onPropertyChange">
          <option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </label>
      <label class="field">House
        <select v-model="form.unit_id" :disabled="!housesHere.length" @change="onHouseChange">
          <option v-for="u in housesHere" :key="u.id" :value="u.id">{{ u.unit_number }} (floor {{ u.floor_number }})</option>
        </select>
      </label>
      <label class="field">House type
        <select v-model="form.unit_type" @change="onTypeChange"><option v-for="t in HOUSE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
      </label>
      <label class="field">Monthly rent (KES) <input v-model="form.rent_amount" inputmode="decimal" @input="rentTouched = true" /></label>
    </div>
    <p v-if="housesHere.length" style="margin-top: -6px"><button class="btn sm" @click="showAddUnit = true"><Icon name="plus" :size="14" />Add house</button> <small class="muted">Rent fills in from your price list for the property, type and floor.</small></p>

    <h2 style="margin-top: 10px">Tenant</h2>
    <div class="form-grid">
      <label class="field">Full name <input v-model="form.full_name" autocomplete="off" /></label>
      <label class="field">Phone number <input v-model="form.phone" inputmode="tel" placeholder="0712 345 678, 0112 345 678 or +44..." /></label>
      <label class="field">ID number <input v-model="form.national_id" /></label>
      <label class="field">Email (optional) <input v-model="form.email" type="email" /></label>
    </div>

    <h2 style="margin-top: 6px">Deposit and dates</h2>
    <div class="form-grid">
      <label class="field">Deposit amount (KES) <input v-model="form.deposit_amount" inputmode="decimal" placeholder="Leave blank if none" /></label>
      <div class="field">Deposit status
        <div class="seg" style="display: flex; margin-top: 6px">
          <button type="button" :class="{ active: !form.deposit_paid }" @click="form.deposit_paid = false">Not yet paid</button>
          <button type="button" :class="{ active: form.deposit_paid }" @click="form.deposit_paid = true">Paid</button>
        </div>
      </div>
      <label class="field">Move-in date <input v-model="form.start_date" type="date" /></label>
      <label class="field">Rent due on day (1-28) <input v-model="form.rent_due_day" type="number" min="1" max="28" inputmode="numeric" /></label>
    </div>

    <label class="field">Send reminders by
      <select v-model="form.preferred_channel">
        <option value="sms">SMS</option>
        <option value="email" :disabled="!emailOk">{{ emailOk ? 'Email' : 'Email (enter an email address first)' }}</option>
      </select>
    </label>

    <footer>
      <button class="btn" @click="showAdd = false">Cancel</button>
      <button class="btn primary" :class="{ busy: saving }" :disabled="saving" @click="saveTenant">Add tenant</button>
    </footer>
  </Modal>

  <Modal v-if="editing" :title="`Edit ${editing.full_name}`" @close="editing = null">
    <div v-if="formError" class="banner error" role="alert">{{ formError }}</div>
    <label class="field">Full name <input v-model="form.full_name" /></label>
    <div class="form-grid">
      <label class="field">Phone <input v-model="form.phone" inputmode="tel" /></label>
      <label class="field">ID number <input v-model="form.national_id" /></label>
    </div>
    <label class="field">Email <input v-model="form.email" type="email" /></label>
    <div class="form-grid">
      <label class="field">Deposit amount (KES) <input v-model="form.deposit_amount" inputmode="decimal" placeholder="None" /></label>
      <div class="field">Deposit status
        <div class="seg" style="display: flex; margin-top: 6px">
          <button type="button" :class="{ active: !form.deposit_paid }" @click="form.deposit_paid = false">Not yet paid</button>
          <button type="button" :class="{ active: form.deposit_paid }" @click="form.deposit_paid = true">Paid</button>
        </div>
      </div>
    </div>
    <label class="field">Send reminders by
      <select v-model="form.preferred_channel">
        <option value="sms">SMS</option>
        <option value="email" :disabled="!emailOk">{{ emailOk ? 'Email' : 'Email (enter an email address first)' }}</option>
      </select>
    </label>
    <footer>
      <button class="btn" @click="editing = null">Cancel</button>
      <button class="btn primary" :class="{ busy: saving }" :disabled="saving" @click="saveEdit">Save changes</button>
    </footer>
  </Modal>

  <AddPropertyModal v-if="showAddProperty" @close="showAddProperty = false" @saved="propertySaved" />
  <AddUnitModal v-if="showAddUnit" :properties="properties" :property-id="form.property_id" @close="showAddUnit = false" @saved="houseSaved" @add-property="showAddUnit = false; showAddProperty = true" />
</template>
