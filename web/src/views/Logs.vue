<script setup>
import { onMounted, ref, watch } from 'vue';
import Icon from '../components/Icon.vue';
import Skeleton from '../components/Skeleton.vue';
import { ago, api, fmtDateTime } from '../api.js';
import { live } from '../live.js';
import { notify } from '../toast.js';

const CATEGORIES = [
  ['', 'All'], ['mpesa', 'M-Pesa'], ['payment', 'Payments'], ['tenant', 'Tenants'], ['unit', 'Units'],
  ['message', 'Messages'], ['broadcast', 'Broadcasts'], ['finance', 'Finance'], ['auth', 'Sign-ins'], ['system', 'System'],
];
const TAGS = { mpesa: 'M-PESA', payment: 'PAYMENT', tenant: 'TENANT', unit: 'UNIT', message: 'MESSAGE', broadcast: 'BROADCAST', finance: 'FINANCE', auth: 'SIGN-IN', system: 'SYSTEM' };

const items = ref([]);
const nextBefore = ref(null);
const loading = ref(true);
const more = ref(false);
const refreshing = ref(false);
const category = ref('');
const q = ref('');

async function load({ append = false } = {}) {
  const qs = new URLSearchParams({ limit: '50' });
  if (category.value) qs.set('category', category.value);
  if (q.value) qs.set('q', q.value);
  if (append && nextBefore.value) qs.set('before', nextBefore.value);

  if (append) more.value = true;
  else refreshing.value = true;
  try {
    const data = await api(`/logs?${qs}`);
    items.value = append ? [...items.value, ...data.items] : data.items;
    nextBefore.value = data.next_before;
  } catch (e) {
    notify.error(e.message);
  } finally {
    loading.value = false;
    more.value = false;
    refreshing.value = false;
  }
}

let timer;
watch([category, q], () => { loading.value = true; clearTimeout(timer); timer = setTimeout(() => load(), 250); });
watch(() => live.tick, () => load());
onMounted(() => load());
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Logs</h1>
      <p class="sub">Every M-Pesa message and activity in the system, newest first.</p>
    </div>
    <div class="actions">
      <button class="btn" :class="{ spinning: refreshing }" @click="load()"><Icon name="refresh" :size="17" />Refresh</button>
    </div>
  </header>

  <div class="toolbar">
    <div class="seg">
      <button v-for="[value, label] in CATEGORIES" :key="value" :class="{ active: category === value }" @click="category = value">{{ label }}</button>
    </div>
    <div class="search"><Icon name="search" :size="16" /><input v-model="q" placeholder="Search the logs" /></div>
  </div>

  <div class="card">
    <Skeleton v-if="loading" type="list" :rows="8" />
    <template v-else>
      <div v-for="i in items" :key="i.id" class="log">
        <span class="tag" :class="i.category">{{ TAGS[i.category] ?? i.category.toUpperCase() }}</span>
        <div class="body">
          <div>{{ i.message }}</div>
          <div class="when">{{ fmtDateTime(i.created_at) }} &middot; {{ ago(i.created_at) }}<template v-if="i.actor_name"> &middot; by {{ i.actor_name }}</template></div>
        </div>
      </div>
      <div v-if="!items.length" class="empty"><strong>Nothing here yet</strong>Activity will be recorded as it happens.</div>
      <div v-if="nextBefore" style="text-align: center; margin-top: 1rem">
        <button class="btn" :class="{ busy: more }" :disabled="more" @click="load({ append: true })">Load older entries</button>
      </div>
    </template>
  </div>
</template>
