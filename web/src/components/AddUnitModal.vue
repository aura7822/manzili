<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { api, kes } from '../api.js';
import { findPrice, HOUSE_TYPES } from '../houseTypes.js';
import { notify } from '../toast.js';

const props = defineProps({
  properties: { type: Array, required: true },
  propertyId: { type: String, default: '' },
});
const emit = defineEmits(['close', 'saved', 'add-property']);

const prices = ref([]);
const form = reactive({
  property_id: props.propertyId || props.properties[0]?.id || '',
  unit_number: '', floor_number: 0, unit_type: 'single', monthly_rent: '',
});
const rentTouched = ref(false);
const autoNote = ref('');
const error = ref('');
const saving = ref(false);

onMounted(async () => {
  try { prices.value = await api('/pricing'); } catch { /* prices are optional help */ }
  autofill();
});

// Rent fills itself in from the landlord's price list once property, house type and floor are known.
function autofill() {
  const price = findPrice(prices.value, form.property_id, form.unit_type, Number(form.floor_number) || 0);
  if (price !== null) {
    autoNote.value = `Price list: ${kes(price)} for this property, type and floor.`;
    if (!rentTouched.value) form.monthly_rent = String(Number(price));
  } else {
    autoNote.value = 'No price set for this combination yet. Enter the rent, or set prices on the Control Panel.';
    if (!rentTouched.value) form.monthly_rent = '';
  }
}
watch(() => [form.property_id, form.unit_type, form.floor_number], autofill);

const noProperty = computed(() => props.properties.length === 0);

async function save() {
  if (noProperty.value) { error.value = 'Add a property first, then you can add houses to it.'; return; }
  if (!form.unit_number.trim()) { error.value = 'Please enter the house number, for example A1.'; return; }
  if (!String(form.monthly_rent).trim()) { error.value = 'Please enter the monthly rent.'; return; }
  saving.value = true;
  error.value = '';
  try {
    const created = await api('/units', {
      method: 'POST',
      body: {
        property_id: form.property_id, unit_number: form.unit_number, floor_number: Number(form.floor_number) || 0,
        unit_type: form.unit_type, monthly_rent: String(form.monthly_rent),
      },
    });
    notify.success(`House ${form.unit_number} added. It is vacant until you add a tenant.`);
    emit('saved', created);
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal title="Add house" @close="emit('close')">
    <div v-if="error" class="banner error" role="alert">{{ error }}</div>
    <div v-if="noProperty" class="banner info row">
      <span>You need a property before you can add houses.</span>
      <button class="btn sm" @click="emit('add-property')">Add property</button>
    </div>
    <label v-if="properties.length" class="field">Property
      <select v-model="form.property_id"><option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option></select>
    </label>
    <div class="form-grid">
      <label class="field">House type
        <select v-model="form.unit_type"><option v-for="t in HOUSE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
      </label>
      <label class="field">Floor <input v-model="form.floor_number" type="number" inputmode="numeric" /></label>
      <label class="field">House number <input v-model="form.unit_number" placeholder="e.g. A1" /></label>
      <label class="field">Monthly rent (KES) <input v-model="form.monthly_rent" inputmode="decimal" @input="rentTouched = true" /></label>
    </div>
    <p class="muted"><small>{{ autoNote }}</small></p>
    <footer>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :class="{ busy: saving }" :disabled="saving || noProperty" @click="save">Save house</button>
    </footer>
  </Modal>
</template>
