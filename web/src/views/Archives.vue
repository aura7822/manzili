<script setup>
import { onMounted, ref, watch } from 'vue';
import Pill from '../components/Pill.vue';
import Skeleton from '../components/Skeleton.vue';
import { api, fmtDate, kes } from '../api.js';
import { typeLabel } from '../houseTypes.js';
import { live } from '../live.js';
import { notify } from '../toast.js';

const rows = ref([]);
const loading = ref(true);

async function load() {
  try {
    rows.value = await api('/archives');
  } catch (e) {
    notify.error(e.message);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(() => live.tick, load);
</script>

<template>
  <header class="page-head">
    <div>
      <h1>Archives</h1>
      <p class="sub">Tenants who have moved out. Their records are permanently deleted 60 days after they vacate.</p>
    </div>
  </header>

  <div class="card">
    <Skeleton v-if="loading" :rows="5" :cols="8" />
    <div v-else class="table-wrap">
      <table class="stack">
        <thead>
          <tr><th>Tenant</th><th>ID no.</th><th>House</th><th>Vacated</th><th class="num">Total paid</th><th class="num">Unpaid at exit</th><th>Deposit</th><th>Deleted in</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in rows" :key="a.id">
            <td data-label="Tenant"><strong>{{ a.tenant_name }}</strong><small>{{ a.phone }}</small></td>
            <td data-label="ID no.">{{ a.national_id ?? '-' }}</td>
            <td data-label="House"><strong>{{ a.unit_number }}</strong><small>{{ a.property_name }}<template v-if="a.unit_type"> &middot; {{ typeLabel(a.unit_type) }}</template></small></td>
            <td data-label="Vacated">{{ fmtDate(a.vacated_at) }}</td>
            <td data-label="Total paid" class="num">{{ kes(a.total_paid) }}</td>
            <td data-label="Unpaid at exit" class="num" :style="Number(a.outstanding_balance) > 0 ? 'color: var(--cherry); font-weight: 700' : ''">{{ kes(a.outstanding_balance) }}</td>
            <td data-label="Deposit"><template v-if="Number(a.deposit_amount) > 0">{{ kes(a.deposit_amount) }}<small>{{ a.deposit_paid ? 'was paid, refund may be due' : 'was never paid' }}</small></template><span v-else class="muted">None</span></td>
            <td data-label="Deleted in"><span class="pill" :class="a.days_left <= 7 ? 'pill-overdue' : 'pill-pending'">{{ a.days_left }} day{{ a.days_left === 1 ? '' : 's' }}</span></td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="8" class="empty cell-empty"><strong>The archive is empty</strong>When you vacate a house, the tenant's details are kept here for 60 days.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
