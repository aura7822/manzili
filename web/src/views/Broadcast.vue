<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Icon from '../components/Icon.vue';
import Modal from '../components/Modal.vue';
import Pill from '../components/Pill.vue';
import Skeleton from '../components/Skeleton.vue';
import { api } from '../api.js';
import { HOUSE_TYPES, typeLabel } from '../houseTypes.js';
import { notify } from '../toast.js';

const MAX = 600;
const message = ref('');
const mode = ref('filters'); // filters | pick
const filters = reactive({ unit_type: '', floor: '', status: '', deposit: '', property_id: '' });
const units = ref([]);
const properties = ref([]);
const ready = ref(false);
const recipients = ref([]);
const picked = ref(new Set());
const previewing = ref(false);
const confirming = ref(false);
const sending = ref(false);
const result = ref(null);
const pickQuery = ref('');

onMounted(async () => {
  try {
    [units.value, properties.value] = await Promise.all([api('/units/overview'), api('/properties')]);
  } catch (e) {
    notify.error(e.message);
  } finally {
    ready.value = true;
  }
  refreshPreview();
});

const floors = computed(() =>
  [...new Set(units.value.filter((u) => !filters.property_id || u.property_id === filters.property_id).map((u) => u.floor_number))].sort((a, b) => a - b));

const payload = () => ({
  unit_type: filters.unit_type || undefined,
  floor: filters.floor === '' ? undefined : Number(filters.floor),
  status: filters.status || undefined,
  deposit: filters.deposit || undefined,
  property_id: filters.property_id || undefined,
});

async function refreshPreview() {
  previewing.value = true;
  try {
    const r = await api('/broadcast/preview', { method: 'POST', body: { filters: payload() } });
    recipients.value = r.recipients;
    const ids = new Set(r.recipients.map((x) => x.id));
    picked.value = new Set([...picked.value].filter((id) => ids.has(id)));
  } catch (e) {
    notify.error(e.message);
  } finally {
    previewing.value = false;
  }
}

let timer;
watch(filters, () => { clearTimeout(timer); timer = setTimeout(refreshPreview, 250); });
watch(() => filters.property_id, () => { filters.floor = ''; });

const visible = computed(() => {
  const s = pickQuery.value.trim().toLowerCase();
  return s ? recipients.value.filter((r) => `${r.name} ${r.house}`.toLowerCase().includes(s)) : recipients.value;
});
const targetCount = computed(() => (mode.value === 'pick' ? picked.value.size : recipients.value.length));

const toggle = (id) => {
  const next = new Set(picked.value);
  next.has(id) ? next.delete(id) : next.add(id);
  picked.value = next;
};
const selectAll = () => { picked.value = new Set([...picked.value, ...visible.value.map((r) => r.id)]); };
const clearAll = () => { picked.value = new Set(); };

const insert = (token) => { message.value = `${message.value}${message.value && !message.value.endsWith(' ') ? ' ' : ''}${token}`; };
const canSend = computed(() => message.value.trim().length > 0 && targetCount.value > 0);

const STATUS = { paid: 'rent paid', unpaid: 'rent not fully paid', overdue: 'rent overdue', pending: 'rent pending', partial: 'rent part paid' };
const audience = computed(() => {
  if (mode.value === 'pick') return `${picked.value.size} hand-picked tenant${picked.value.size === 1 ? '' : 's'}`;
  const parts = [];
  if (filters.unit_type) parts.push(`${typeLabel(filters.unit_type).toLowerCase()} houses`);
  if (filters.floor !== '') parts.push(`floor ${filters.floor}`);
  if (filters.status) parts.push(STATUS[filters.status]);
  if (filters.deposit) parts.push(`deposit ${filters.deposit}`);
  return parts.length ? parts.join(', ') : 'all tenants';
});

async function send() {
  sending.value = true;
  try {
    const body = { message: message.value, filters: payload() };
    if (mode.value === 'pick') body.tenant_ids = [...picked.value];
    const r = await api('/broadcast/send', { method: 'POST', body });
    confirming.value = false;
    result.value = r;
    if (r.failed === 0) {
      notify.success(`Message sent to ${r.sent} tenant${r.sent === 1 ? '' : 's'}.`);
      message.value = '';
    } else {
      notify.warn(`Sent to ${r.sent} of ${r.total}. ${r.failed} could not be reached.`);
    }
  } catch (e) {
    confirming.value = false;
    notify.error(e.message);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Broadcast</h1>
      <p class="sub">Send one message to all tenants, a group, or people you pick.</p>
    </div>
  </header>

  <div class="bento">
    <div class="tile s5">
      <h2>Your message</h2>
      <label class="field">Message
        <textarea v-model="message" :maxlength="MAX" rows="6" placeholder="e.g. Hello {name}, water will be off tomorrow from 9am to 1pm." />
      </label>
      <div class="toolbar" style="justify-content: space-between; margin-bottom: 0">
        <div class="actions">
          <button class="btn sm" @click="insert('{name}')">Insert {name}</button>
          <button class="btn sm" @click="insert('{house}')">Insert {house}</button>
        </div>
        <small class="muted">{{ message.length }}/{{ MAX }}</small>
      </div>
      <p class="muted" style="margin-top: 14px"><small>{name} becomes the tenant's first name and {house} their house number. Messages go out by each tenant's chosen channel (SMS or email).</small></p>
    </div>

    <div class="tile s7">
      <h2>Who should get it?</h2>
      <Skeleton v-if="!ready" type="list" :rows="4" />
      <template v-else>
        <div class="seg" style="margin-bottom: 16px">
          <button :class="{ active: mode === 'filters' }" @click="mode = 'filters'">By filters</button>
          <button :class="{ active: mode === 'pick' }" @click="mode = 'pick'">Pick tenants</button>
        </div>

        <div class="form-grid">
          <label v-if="properties.length > 1" class="field">Property
            <select v-model="filters.property_id"><option value="">All properties</option><option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option></select>
          </label>
          <label class="field">House type
            <select v-model="filters.unit_type"><option value="">All types</option><option v-for="t in HOUSE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
          </label>
          <label class="field">Floor
            <select v-model="filters.floor"><option value="">All floors</option><option v-for="f in floors" :key="f" :value="f">Floor {{ f }}</option></select>
          </label>
          <label class="field">Rent status
            <select v-model="filters.status">
              <option value="">Any</option><option value="paid">Paid</option><option value="unpaid">Not fully paid</option>
              <option value="overdue">Overdue</option><option value="pending">Pending</option><option value="partial">Part paid</option>
            </select>
          </label>
          <label class="field">Deposit
            <select v-model="filters.deposit"><option value="">Any</option><option value="paid">Paid</option><option value="pending">Pending</option></select>
          </label>
        </div>

        <template v-if="mode === 'pick'">
          <div class="toolbar" style="margin-bottom: 10px">
            <div class="search"><Icon name="search" :size="16" /><input v-model="pickQuery" placeholder="Find a tenant" /></div>
            <button class="btn sm" @click="selectAll">Select all shown</button>
            <button class="btn sm" @click="clearAll">Clear</button>
          </div>
          <div class="checks" role="group" aria-label="Tenants">
            <label v-for="r in visible" :key="r.id" class="check-row">
              <input type="checkbox" :checked="picked.has(r.id)" @change="toggle(r.id)" />
              <span class="grow"><strong>{{ r.name }}</strong> <span class="muted">house {{ r.house }}</span></span>
              <Pill v-if="r.unit_type" :status="r.unit_type" />
              <Pill :status="r.rent_status" />
            </label>
            <div v-if="!visible.length" class="empty">No tenants match these filters.</div>
          </div>
        </template>

        <div class="banner info" style="margin: 16px 0">
          <template v-if="previewing && !recipients.length">Counting recipients...</template>
          <template v-else>
            <strong>{{ targetCount }}</strong> tenant{{ targetCount === 1 ? '' : 's' }} will receive this ({{ audience }}).
          </template>
        </div>

        <button class="btn primary block" :disabled="!canSend" @click="confirming = true"><Icon name="send" :size="16" />Review and send</button>
        <p v-if="!message.trim()" class="muted" style="margin: 10px 0 0"><small>Write a message to enable sending.</small></p>
        <p v-else-if="mode === 'pick' && !picked.size" class="muted" style="margin: 10px 0 0"><small>Tick at least one tenant.</small></p>
        <p v-else-if="!recipients.length" class="muted" style="margin: 10px 0 0"><small>No tenants match these filters.</small></p>
      </template>
    </div>
  </div>

  <Modal v-if="confirming" title="Send this message?" @close="confirming = false">
    <p>It will go to <strong>{{ targetCount }}</strong> tenant{{ targetCount === 1 ? '' : 's' }} ({{ audience }}).</p>
    <div class="banner info" style="white-space: pre-wrap">{{ message }}</div>
    <footer>
      <button class="btn" @click="confirming = false">Go back</button>
      <button class="btn primary" :class="{ busy: sending }" :disabled="sending" @click="send">Send now</button>
    </footer>
  </Modal>

  <Modal v-if="result" title="Broadcast finished" @close="result = null">
    <div class="banner" :class="result.failed ? 'info' : 'ok'">Delivered to {{ result.sent }} of {{ result.total }} tenants.</div>
    <template v-if="result.failed">
      <p>These could not be reached:</p>
      <ul class="muted"><li v-for="f in result.failures" :key="f.house + f.tenant"><strong>{{ f.tenant }}</strong> (house {{ f.house }}): {{ f.reason }}</li></ul>
    </template>
    <footer><button class="btn primary" @click="result = null">Done</button></footer>
  </Modal>
</template>
