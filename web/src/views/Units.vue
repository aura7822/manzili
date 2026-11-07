<script setup>
import { computed, onMounted, ref, watch } from 'vue';
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
const units = ref([]);
const properties = ref([]);
const pricing = ref([]);
const loading = ref(true);
const tab = ref('all');
const q = ref('');
const propertyFilter = ref(String(route.query.property_id ?? ''));

watch(() => route.query.property_id, (value) => {
  propertyFilter.value = String(value ?? '');
}, { immediate: true });

watch(propertyFilter, (value) => {
  const query = { ...route.query };
  if (value) {
    if (query.property_id !== value) query.property_id = value;
  } else {
    delete query.property_id;
  }
  if (Object.keys(query).length !== Object.keys(route.query).length || Object.entries(query).some(([k, v]) => route.query[k] !== v)) {
    router.replace({ query });
  }
});

async function load({ silent = true } = {}) {
  if (!silent) loading.value = true;
  const qs = new URLSearchParams();
  if (q.value) qs.set('q', q.value);
  if (propertyFilter.value) qs.set('property_id', propertyFilter.value);
  try {
    [units.value, properties.value, pricing.value] = await Promise.all([api(`/units/overview?${qs}`), api('/properties'), api('/pricing')]);
  } catch (e) {
    notify.error(e.message);
  } finally {
    loading.value = false;
  }
}

let timer;
watch([q, propertyFilter], () => { clearTimeout(timer); timer = setTimeout(() => load(), 250); });
watch(() => live.tick, () => load());
onMounted(() => load({ silent: false }));

const counts = computed(() => ({
  all: units.value.length,
  occupied: units.value.filter((u) => u.status === 'occupied').length,
  vacant: units.value.filter((u) => u.status === 'vacant').length,
}));
const shown = computed(() => units.value.filter((u) => tab.value === 'all' || u.status === tab.value));
const tenure = (u) => (u.lease_id ? `${u.tenure_years}y ${u.tenure_months}m` : '-');
const hasDeposit = (u) => u.lease_id && Number(u.deposit_amount) > 0;

/* ---------- dialogs ---------- */
const showProperty = ref(false);
const showUnit = ref(false);
const editingProperty = ref(null);
const editingUnit = ref(null);
const deletingProperty = ref(null);
const deletingUnit = ref(null);
const propertyDeleteBusy = ref(false);
const unitDeleteBusy = ref(false);

function openPropertyAdd() {
  editingProperty.value = null;
  showProperty.value = true;
}

function openPropertyEdit(property) {
  editingProperty.value = { ...property };
  showProperty.value = false;
}

function openUnitAdd() {
  editingUnit.value = null;
  showUnit.value = true;
}

function openUnitEdit(unit) {
  editingUnit.value = { ...unit };
  showUnit.value = false;
}

async function propertySaved() {
  showProperty.value = false;
  editingProperty.value = null;
  await load({ silent: false });
}
async function unitSaved() {
  showUnit.value = false;
  editingUnit.value = null;
  await load({ silent: false });
}

async function confirmDeleteProperty() {
  const property = deletingProperty.value;
  if (!property) return;
  propertyDeleteBusy.value = true;
  try {
    await api(`/properties/${property.id}`, { method: 'DELETE' });
    notify.success(`${property.name} was deleted.`);
    deletingProperty.value = null;
    await load({ silent: false });
  } catch (e) {
    notify.error(e.message);
  } finally {
    propertyDeleteBusy.value = false;
  }
}

async function confirmDeleteUnit() {
  const unit = deletingUnit.value;
  if (!unit) return;
  unitDeleteBusy.value = true;
  try {
    await api(`/units/${unit.id}`, { method: 'DELETE' });
    notify.success(`House ${unit.unit_number} was deleted.`);
    deletingUnit.value = null;
    await load({ silent: false });
  } catch (e) {
    notify.error(e.message);
  } finally {
    unitDeleteBusy.value = false;
  }
}

const qr = ref(null);
const qrDraft = ref(null);

const defaultRentFor = (property, unitType, floorNumber) => {
  const value = findPrice(pricing.value, property.id, unitType, Number(floorNumber) || 0);
  return value == null ? '' : String(Number(value));
};

function showQr(p) {
  const unitType = HOUSE_TYPES[0].value;
  qrDraft.value = {
    property: p,
    unit_type: unitType,
    floor_number: '',
    amount: defaultRentFor(p, unitType, ''),
  };
}

async function generateQr() {
  if (!qrDraft.value) return;
  try {
    const { property, unit_type, floor_number, amount } = qrDraft.value;
    const qs = new URLSearchParams();
    if (unit_type) qs.set('unit_type', unit_type);
    if (floor_number !== '') qs.set('floor_number', String(floor_number));
    if (String(amount ?? '').trim()) qs.set('amount', String(amount));
    qr.value = { name: property.name, ...(await api(`/properties/${property.id}/qr?${qs}`)) };
    qrDraft.value = null;
  } catch (e) {
    notify.error(e.message);
  }
}

watch(() => qrDraft.value?.unit_type, (value) => {
  if (!qrDraft.value || !qrDraft.value.property) return;
  const floor = Number(qrDraft.value.floor_number) || 0;
  if (value) qrDraft.value.amount = defaultRentFor(qrDraft.value.property, value, floor);
});
watch(() => qrDraft.value?.floor_number, (value) => {
  if (!qrDraft.value || !qrDraft.value.property || !qrDraft.value.unit_type) return;
  qrDraft.value.amount = defaultRentFor(qrDraft.value.property, qrDraft.value.unit_type, value);
});
const printPage = () => window.print();

/* ---------- vacate ---------- */
const vacating = ref(null);
const vacateBusy = ref(false);

async function confirmVacate() {
  vacateBusy.value = true;
  try {
    const r = await api(`/units/${vacating.value.id}/vacate`, { method: 'POST' });
    const owed = Number(r.outstanding_balance) > 0 ? ` Unpaid rent of ${kes(r.outstanding_balance)} was noted in the archive.` : '';
    notify.success(`House ${r.unit_number} is now vacant. ${r.tenant_name}'s details were moved to Archives and will be deleted on ${fmtDate(r.purge_at)}.${owed}`);
    vacating.value = null;
    await load({ silent: false });
  } catch (e) {
    notify.error(e.message);
  } finally {
    vacateBusy.value = false;
  }
}

const addTenant = (u) => router.push({ path: '/tenants', query: { unit: u.id } });
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Units</h1>
      <p class="sub">See which houses are occupied or vacant, and who lives where.</p>
    </div>
    <div v-if="canManage()" class="actions">
      <button class="btn" @click="openPropertyAdd()"><Icon name="plus" :size="16" />Property</button>
      <button class="btn primary" @click="openUnitAdd()"><Icon name="plus" :size="16" />House</button>
    </div>
  </header>

  <div v-if="properties.length" class="card">
    <h2>Properties and payment QR codes</h2>
    <div class="table-wrap">
      <table class="stack">
        <thead><tr><th>Name</th><th>Address</th><th class="num">Houses</th><th /></tr></thead>
        <tbody>
          <tr v-for="p in properties" :key="p.id">
            <td data-label="Name"><strong>{{ p.name }}</strong></td>
            <td data-label="Address">{{ p.address }}<template v-if="p.city">, {{ p.city }}</template></td>
            <td data-label="Houses" class="num">{{ p.unit_count }}</td>
            <td class="cell-actions">
              <div class="row-actions">
                <button v-if="canManage()" class="btn sm icon-btn" aria-label="Edit property" title="Edit property" @click="openPropertyEdit(p)"><Icon name="edit" :size="15" /></button>
                <button v-if="canManage()" class="btn sm icon-btn danger" aria-label="Delete property" title="Delete property" @click="deletingProperty = p"><Icon name="trash" :size="15" /></button>
                <button class="btn sm" @click="showQr(p)"><Icon name="qr" :size="15" />Payment QR</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="toolbar">
    <div class="seg" role="tablist">
      <button :class="{ active: tab === 'all' }" @click="tab = 'all'">All<span class="count">{{ counts.all }}</span></button>
      <button :class="{ active: tab === 'occupied' }" @click="tab = 'occupied'">Occupied<span class="count">{{ counts.occupied }}</span></button>
      <button :class="{ active: tab === 'vacant' }" @click="tab = 'vacant'">Vacant<span class="count">{{ counts.vacant }}</span></button>
    </div>
    <div class="search"><Icon name="search" :size="16" /><input v-model="q" placeholder="Search house, name, phone or ID" /></div>
    <select v-if="properties.length > 1" v-model="propertyFilter" aria-label="Property">
      <option value="">All properties</option>
      <option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
  </div>

  <div class="card">
    <Skeleton v-if="loading" :rows="6" :cols="9" />
    <div v-else class="table-wrap">
      <table class="stack">
        <thead>
          <tr><th>Status</th><th>Property</th><th>House</th><th>Floor</th><th>Type</th><th class="num">Rent</th><th>Deposit</th><th>Tenant</th><th>Phone</th><th>ID no.</th><th>Since</th><th>Tenure</th><th v-if="canManage()" /></tr>
        </thead>
        <tbody>
          <tr v-for="u in shown" :key="u.id">
            <td data-label="Status"><Pill :status="u.status" dot /></td>
            <td data-label="Property"><strong>{{ u.property_name }}</strong></td>
            <td data-label="House"><strong>{{ u.unit_number }}</strong></td>
            <td data-label="Floor">{{ u.floor_number }}</td>
            <td data-label="Type"><Pill v-if="u.unit_type" :status="u.unit_type" /><span v-else class="muted">-</span></td>
            <td data-label="Rent" class="num">{{ kes(u.monthly_rent) }}</td>
            <td data-label="Deposit">
              <template v-if="hasDeposit(u)"><Pill :status="u.deposit_status === 'held' ? 'paid' : 'pending'" /><small>{{ kes(u.deposit_amount) }}</small></template>
              <span v-else class="muted">{{ u.lease_id ? 'None' : '-' }}</span>
            </td>
            <td data-label="Tenant"><template v-if="u.tenant_name">{{ u.tenant_name }}</template><span v-else class="muted">Vacant</span></td>
            <td data-label="Phone">{{ u.tenant_phone ?? '-' }}</td>
            <td data-label="ID no.">{{ u.national_id ?? '-' }}</td>
            <td data-label="Since">{{ u.lease_start ? fmtDate(u.lease_start) : '-' }}</td>
            <td data-label="Tenure">{{ tenure(u) }}</td>
            <td v-if="canManage()" class="cell-actions">
              <div class="row-actions">
                <button class="btn sm icon-btn" aria-label="Edit house" title="Edit house" @click="openUnitEdit(u)"><Icon name="edit" :size="15" /></button>
                <button class="btn sm icon-btn danger" aria-label="Delete house" title="Delete house" @click="deletingUnit = u"><Icon name="trash" :size="15" /></button>
                <button v-if="u.status === 'occupied'" class="btn sm danger" @click="vacating = u"><Icon name="logout" :size="15" />Vacate</button>
                <button v-else-if="u.status === 'vacant'" class="btn sm" @click="addTenant(u)"><Icon name="plus" :size="15" />Add tenant</button>
              </div>
            </td>
          </tr>
          <tr v-if="!shown.length">
            <td :colspan="canManage() ? 13 : 12" class="empty cell-empty">
              <template v-if="!properties.length"><strong>No properties yet</strong>Add your first property, then its houses.</template>
              <template v-else-if="tab === 'vacant'"><strong>No vacant houses</strong>Every house is currently occupied.</template>
              <template v-else><strong>Nothing to show</strong>Try a different search or filter.</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <AddPropertyModal v-if="showProperty || editingProperty" :property="editingProperty" @close="showProperty = false; editingProperty = null" @saved="propertySaved" />
  <AddUnitModal v-if="showUnit || editingUnit" :properties="properties" :property-id="propertyFilter" :unit="editingUnit" @close="showUnit = false; editingUnit = null" @saved="unitSaved" @add-property="showUnit = false; editingUnit = null; showProperty = true" />

  <Modal v-if="qrDraft" :title="`Generate QR for ${qrDraft.property.name}`" @close="qrDraft = null">
    <div class="form-grid">
      <label class="field">House type
        <select v-model="qrDraft.unit_type">
          <option v-for="t in HOUSE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </label>
      <label class="field">Floor number
        <input v-model.number="qrDraft.floor_number" type="number" min="-5" max="150" placeholder="All floors" />
      </label>
      <label class="field">Default rent (KES)
        <input v-model="qrDraft.amount" type="number" min="1" step="1" placeholder="0" />
      </label>
    </div>
    <p class="muted" style="margin-top: 0">This QR will open the payment page for the chosen house type and floor, with the rent pre-filled and editable.</p>
    <footer>
      <button class="btn" @click="qrDraft = null">Cancel</button>
      <button class="btn primary" @click="generateQr">Generate QR</button>
    </footer>
  </Modal>

  <Modal v-if="qr" :title="`Payment QR: ${qr.name}`" @close="qr = null">
    <div class="qr" v-html="qr.svg" />
    <p class="muted" style="text-align: center; word-break: break-all; margin-top: .8rem">{{ qr.url }}</p>
    <footer><button class="btn" @click="qr = null">Close</button><button class="btn primary" @click="printPage">Print</button></footer>
  </Modal>

  <Modal v-if="deletingProperty" :title="`Delete property ${deletingProperty.name}?`" @close="deletingProperty = null">
    <p><strong>{{ deletingProperty.name }}</strong> and all of its saved house records will be removed.</p>
    <ul class="muted" style="padding-left: 1.1rem; margin-top: .5rem">
      <li>This action is permanent.</li>
      <li>Only delete a property after the houses are vacant and no lease history remains.</li>
    </ul>
    <footer>
      <button class="btn" @click="deletingProperty = null">Cancel</button>
      <button class="btn danger" :class="{ busy: propertyDeleteBusy }" :disabled="propertyDeleteBusy" @click="confirmDeleteProperty">Delete property</button>
    </footer>
  </Modal>

  <Modal v-if="deletingUnit" :title="`Delete house ${deletingUnit.unit_number}?`" @close="deletingUnit = null">
    <p><strong>{{ deletingUnit.unit_number }}</strong> will be permanently removed from this property.</p>
    <ul class="muted" style="padding-left: 1.1rem; margin-top: .5rem">
      <li>This is irreversible.</li>
      <li>Only delete a house when it has no active tenant or lease history.</li>
    </ul>
    <footer>
      <button class="btn" @click="deletingUnit = null">Cancel</button>
      <button class="btn danger" :class="{ busy: unitDeleteBusy }" :disabled="unitDeleteBusy" @click="confirmDeleteUnit">Delete house</button>
    </footer>
  </Modal>

  <Modal v-if="vacating" :title="`Vacate house ${vacating.unit_number}?`" @close="vacating = null">
    <p><strong>{{ vacating.tenant_name }}</strong> will be removed from this house and it will become vacant straight away.</p>
    <ul class="muted" style="padding-left: 1.1rem">
      <li>Their details move to <strong>Archives</strong> and are permanently deleted after 60 days.</li>
      <li>Any unpaid rent is recorded in the archive and stops reminders.</li>
    </ul>
    <footer>
      <button class="btn" @click="vacating = null">Keep tenant</button>
      <button class="btn primary" :class="{ busy: vacateBusy }" :disabled="vacateBusy" @click="confirmVacate">Yes, vacate</button>
    </footer>
  </Modal>
</template>
