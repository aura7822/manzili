<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AddPropertyModal from '../components/AddPropertyModal.vue';
import AddUnitModal from '../components/AddUnitModal.vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import Pill from '../components/Pill.vue';
import Skeleton from '../components/Skeleton.vue';
import { api, canManage, fmtDate, kes } from '../api.js';
import { live } from '../live.js';
import { notify } from '../toast.js';

const router = useRouter();
const units = ref([]);
const properties = ref([]);
const loading = ref(true);
const tab = ref('all');
const q = ref('');
const propertyFilter = ref('');

async function load({ silent = true } = {}) {
  if (!silent) loading.value = true;
  const qs = new URLSearchParams();
  if (q.value) qs.set('q', q.value);
  if (propertyFilter.value) qs.set('property_id', propertyFilter.value);
  try {
    [units.value, properties.value] = await Promise.all([api(`/units/overview?${qs}`), api('/properties')]);
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

async function propertySaved() { showProperty.value = false; await load({ silent: false }); }
async function unitSaved() { showUnit.value = false; await load({ silent: false }); }

const qr = ref(null);
async function showQr(p) {
  try { qr.value = { name: p.name, ...(await api(`/properties/${p.id}/qr`)) }; } catch (e) { notify.error(e.message); }
}
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
      <button class="btn" @click="showProperty = true"><Icon name="plus" :size="16" />Property</button>
      <button class="btn primary" @click="showUnit = true"><Icon name="plus" :size="16" />House</button>
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
            <td class="cell-actions"><div class="row-actions"><button class="btn sm" @click="showQr(p)"><Icon name="qr" :size="15" />Payment QR</button></div></td>
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
          <tr><th>Status</th><th>House</th><th>Floor</th><th>Type</th><th class="num">Rent</th><th>Deposit</th><th>Tenant</th><th>Phone</th><th>ID no.</th><th>Since</th><th>Tenure</th><th v-if="canManage()" /></tr>
        </thead>
        <tbody>
          <tr v-for="u in shown" :key="u.id">
            <td data-label="Status"><Pill :status="u.status" dot /></td>
            <td data-label="House"><strong>{{ u.unit_number }}</strong><small>{{ u.property_name }}</small></td>
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
                <button v-if="u.status === 'occupied'" class="btn sm danger" @click="vacating = u"><Icon name="logout" :size="15" />Vacate</button>
                <button v-else-if="u.status === 'vacant'" class="btn sm" @click="addTenant(u)"><Icon name="plus" :size="15" />Add tenant</button>
              </div>
            </td>
          </tr>
          <tr v-if="!shown.length">
            <td :colspan="canManage() ? 12 : 11" class="empty cell-empty">
              <template v-if="!properties.length"><strong>No properties yet</strong>Add your first property, then its houses.</template>
              <template v-else-if="tab === 'vacant'"><strong>No vacant houses</strong>Every house is currently occupied.</template>
              <template v-else><strong>Nothing to show</strong>Try a different search or filter.</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <AddPropertyModal v-if="showProperty" @close="showProperty = false" @saved="propertySaved" />
  <AddUnitModal v-if="showUnit" :properties="properties" :property-id="propertyFilter" @close="showUnit = false" @saved="unitSaved" @add-property="showUnit = false; showProperty = true" />

  <Modal v-if="qr" :title="`Payment QR: ${qr.name}`" @close="qr = null">
    <div class="qr" v-html="qr.svg" />
    <p class="muted" style="text-align: center; word-break: break-all; margin-top: .8rem">{{ qr.url }}</p>
    <footer><button class="btn" @click="qr = null">Close</button><button class="btn primary" @click="printPage">Print</button></footer>
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
