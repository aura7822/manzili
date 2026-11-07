<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import Icon from '../components/Icon.vue';
import { api, fmtDate, kes } from '../api.js';

const slug = useRoute().params.slug;

const step = ref('loading'); // loading | unit | verify | invoice | waiting | done | none | error
const error = ref('');
const propertyName = ref('');
const units = ref([]);
const unitId = ref('');
const phone = ref('');
const token = ref('');
const tenantName = ref('');
const invoice = ref(null);
const amount = ref('');
const mpesaPhone = ref('');
const result = ref(null);
const busy = ref(false);

let pollTimer = null;
let pollUntil = 0;

onMounted(async () => {
  try {
    const data = await api(`/public/properties/${encodeURIComponent(slug)}/units`);
    propertyName.value = data.property_name;
    units.value = data.units;
    step.value = 'unit';
  } catch (e) {
    error.value = e.message;
    step.value = 'error';
  }
});
onBeforeUnmount(() => clearTimeout(pollTimer));

async function verify() {
  if (phone.value.replace(/\D/g, '').length < 9) {
    error.value = 'Please enter the full phone number, for example 0712 345 678.';
    return;
  }
  error.value = '';
  busy.value = true;
  try {
    const data = await api('/public/verify', { method: 'POST', body: { slug, unit_id: unitId.value, phone: phone.value } });
    token.value = data.token;
    tenantName.value = data.tenant_name;
    mpesaPhone.value = phone.value;
    await loadInvoice();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function loadInvoice() {
  const { invoice: inv } = await api('/public/invoice', { payToken: token.value });
  invoice.value = inv;
  if (!inv) { step.value = 'none'; return; }
  amount.value = String(Math.ceil(Number(inv.balance)));
  step.value = 'invoice';
}

async function pay() {
  const value = Number(amount.value);
  if (!Number.isInteger(value) || value < 1) { error.value = 'Please enter a whole number of shillings, for example 5000.'; return; }
  error.value = '';
  busy.value = true;
  try {
    const { transaction_id } = await api('/public/pay/mpesa', {
      method: 'POST', payToken: token.value,
      body: { invoice_id: invoice.value.id, amount: value, phone: mpesaPhone.value },
    });
    step.value = 'waiting';
    pollUntil = Date.now() + 90_000;
    poll(transaction_id);
  } catch (e) {
    if (e.status === 401) { step.value = 'verify'; }
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

async function poll(id) {
  try {
    const s = await api(`/public/pay/status/${id}`, { payToken: token.value });
    if (s.status === 'success') { result.value = s; step.value = 'done'; return; }
    if (s.status === 'failed' || s.status === 'cancelled') {
      error.value = s.status === 'cancelled' ? 'The payment was cancelled on your phone. You can try again.' : 'The payment did not go through. You can try again.';
      step.value = 'invoice';
      return;
    }
  } catch { /* keep trying until the timeout */ }

  if (Date.now() > pollUntil) {
    error.value = 'We have not received confirmation yet. If money left your M-Pesa you will get an SMS receipt shortly.';
    step.value = 'invoice';
    return;
  }
  pollTimer = setTimeout(() => poll(id), 3000);
}

async function again() {
  result.value = null;
  error.value = '';
  try { await loadInvoice(); } catch (e) { error.value = e.message; }
}
</script>

<template>
  <div class="pay">
    <div class="head">
      <div class="brand-mark"><Icon name="home" :size="28" /></div>
      <h1>{{ propertyName || 'Pay your rent' }}</h1>
      <p class="muted">Pay your rent securely with M-Pesa</p>
    </div>

    <div v-if="error && step !== 'error'" class="banner error" role="alert">{{ error }}</div>

    <div v-if="step === 'loading'" class="card" aria-busy="true">
      <div class="sk" style="height: 14px; width: 55%" />
      <div class="sk" style="height: 50px; margin-top: 14px" />
      <div class="sk" style="height: 50px; margin-top: 14px" />
    </div>

    <div v-else-if="step === 'error'" class="card center">
      <p><strong>This page is not available</strong></p>
      <p class="muted">{{ error }}</p>
    </div>

    <div v-else-if="step === 'unit'" class="card">
      <label class="field">Select your house number
        <select v-model="unitId"><option value="" disabled>Choose your house</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.unit_number }}</option></select>
      </label>
      <p v-if="!units.length" class="muted">No occupied houses are listed for this property yet.</p>
      <button class="btn primary block" :disabled="!unitId" @click="step = 'verify'; error = ''">Continue</button>
    </div>

    <div v-else-if="step === 'verify'" class="card">
      <label class="field">Phone number registered with your landlord
        <input v-model="phone" inputmode="tel" placeholder="0712 345 678 or 0112 345 678" autocomplete="tel" @keyup.enter="verify" />
      </label>
      <button class="btn primary block" :class="{ busy }" :disabled="busy" @click="verify">Find my rent</button>
      <p style="text-align: center; margin: .9rem 0 0"><a href="#" @click.prevent="step = 'unit'; error = ''">Back</a></p>
    </div>

    <div v-else-if="step === 'none'" class="card center">
      <p><strong>Hi {{ tenantName }}, you have no rent due.</strong></p>
      <p class="muted">Nothing is outstanding for your house right now. Thank you!</p>
    </div>

    <div v-else-if="step === 'invoice'" class="card">
      <p>Hi {{ tenantName }}, here is your rent for house <strong>{{ invoice.unit_number }}</strong>.</p>
      <div class="row"><span class="muted">Month</span><strong>{{ invoice.billing_period.slice(0, 7) }}</strong></div>
      <div class="row"><span class="muted">Due date</span><strong>{{ fmtDate(invoice.due_date) }}</strong></div>
      <div class="row"><span class="muted">Rent</span><span>{{ kes(invoice.amount_due) }}</span></div>
      <div class="row"><span class="muted">Paid so far</span><span>{{ kes(invoice.amount_paid) }}</span></div>
      <div class="amount">{{ kes(invoice.balance) }}</div>
      <p class="center muted" style="margin-bottom: 1rem">balance{{ invoice.status === 'overdue' ? ' (overdue)' : '' }}</p>

      <label class="field">Amount to pay (whole shillings)
        <input v-model="amount" inputmode="numeric" />
      </label>
      <label class="field">M-Pesa number
        <input v-model="mpesaPhone" inputmode="tel" />
      </label>
      <button class="btn primary block" :class="{ busy }" :disabled="busy" @click="pay">Pay KES {{ Number(amount || 0).toLocaleString() }}</button>
    </div>

    <div v-else-if="step === 'waiting'" class="card center">
      <div class="spinner" />
      <p><strong>Check your phone</strong></p>
      <p class="muted">Enter your M-Pesa PIN to approve the payment. Please keep this page open.</p>
    </div>

    <div v-else-if="step === 'done'" class="card center">
      <div class="tick"><Icon name="check" :size="34" /></div>
      <p><strong>Payment received. Thank you!</strong></p>
      <p style="font-size: 1.4rem; font-weight: 800">{{ kes(result.amount) }}</p>
      <p class="muted">Receipt {{ result.receipt_number }}</p>
      <a class="btn block" style="margin-bottom: .7rem" :href="`/api/public/receipts/${result.receipt_number}`" target="_blank" rel="noopener">Download receipt</a>
      <template v-if="Number(result.balance) > 0">
        <p class="muted">Remaining balance: {{ kes(result.balance) }}</p>
        <button class="btn primary block" @click="again">Pay the rest</button>
      </template>
    </div>
  </div>
</template>
