<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { api, kes } from '../api.js';
import { findPrice, HOUSE_TYPES } from '../houseTypes.js';
import { notify } from '../toast.js';

const props = defineProps({
  properties: { type: Array, required: true },
  propertyId: { type: String, default: '' },
  unit: { type: Object, default: null },
});
const emit = defineEmits(['close', 'saved', 'add-property']);

const prices = ref([]);
const isEdit = computed(() => Boolean(props.unit));
const form = reactive({
  property_id: props.propertyId || props.properties[0]?.id || '',
  unit_number: '', floor_number: 0, unit_type: 'single', monthly_rent: '',
  tenant_name: '', tenant_phone: '', tenant_id: '',
});
const rentTouched = ref(false);
const autoNote = ref('');
const error = ref('');
const saving = ref(false);

function resetForm() {
  const unit = props.unit;
  form.property_id = unit?.property_id || props.propertyId || props.properties[0]?.id || '';
  form.unit_number = unit?.unit_number ?? '';
  form.floor_number = unit?.floor_number ?? 0;
  form.unit_type = unit?.unit_type ?? 'single';
  form.monthly_rent = unit?.monthly_rent != null ? String(unit.monthly_rent) : '';
  form.tenant_name = unit?.tenant_name ?? '';
  form.tenant_phone = unit?.tenant_phone ?? '';
  form.tenant_id = unit?.tenant_id ?? '';
  rentTouched.value = Boolean(unit);
}

watch(() => props.unit, () => resetForm(), { immediate: true });
watch(() => props.propertyId, (value) => {
  if (!props.unit && value) form.property_id = value;
}, { immediate: true });

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
    const payload = {
      property_id: form.property_id,
      unit_number: form.unit_number.trim(),
      floor_number: Number(form.floor_number) || 0,
      unit_type: form.unit_type,
      monthly_rent: String(form.monthly_rent),
    };

    let saved;
    if (isEdit.value) {
      saved = await api(`/units/${props.unit.id}`, { method: 'PATCH', body: payload });
      if (form.tenant_id) {
        const tenantPatch = {};
        if (form.tenant_name.trim() && form.tenant_name.trim() !== (props.unit.tenant_name || '').trim()) tenantPatch.full_name = form.tenant_name.trim();
        if (form.tenant_phone.trim() && form.tenant_phone.trim() !== (props.unit.tenant_phone || '').trim()) tenantPatch.phone = form.tenant_phone.trim();
        if (Object.keys(tenantPatch).length) await api(`/tenants/${form.tenant_id}`, { method: 'PATCH', body: tenantPatch });
      }
      notify.success(`House ${form.unit_number} was updated.`);
    } else {
      saved = await api('/units', { method: 'POST', body: payload });
      notify.success(`House ${form.unit_number} added. It is vacant until you add a tenant.`);
    }

    emit('saved', saved);
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="isEdit ? 'Edit house' : 'Add house'" @close="emit('close')">
    <div v-if="error" class="banner error" role="alert">{{ error }}</div>
    <div v-if="noProperty" class="banner info row">
      <span>You need a property before you can add houses.</span>
      <button class="btn sm" @click="emit('add-property')">Add property</button>
    </div>
    <label v-if="properties.length" class="field">Property
      <select v-model="form.property_id" :disabled="isEdit"><option v-for="p in properties" :key="p.id" :value="p.id">{{ p.name }}</option></select>
    </label>
    <div class="form-grid">
      <label class="field">House type
        <select v-model="form.unit_type"><option v-for="t in HOUSE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option></select>
      </label>
      <label class="field">Floor <input v-model="form.floor_number" type="number" inputmode="numeric" /></label>
      <label class="field">House number <input v-model="form.unit_number" placeholder="e.g. A1" /></label>
      <label class="field">Monthly rent (KES) <input v-model="form.monthly_rent" inputmode="decimal" @input="rentTouched = true" /></label>
    </div>
    <div v-if="isEdit && form.tenant_id" class="form-grid" style="margin-top: 10px">
      <label class="field">Tenant name <input v-model="form.tenant_name" placeholder="Current tenant" /></label>
      <label class="field">Tenant phone <input v-model="form.tenant_phone" inputmode="tel" placeholder="0712 345 678" /></label>
    </div>
    <p class="muted"><small>{{ autoNote }}</small></p>
    <footer>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :class="{ busy: saving }" :disabled="saving || noProperty" @click="save">{{ isEdit ? 'Save changes' : 'Save house' }}</button>
    </footer>
  </Modal>
</template>
