<script setup>
import { reactive, ref } from 'vue';
import Icon from './Icon.vue';
import Modal from './Modal.vue';
import { api } from '../api.js';
import { HOUSE_TYPES, typeLabel } from '../houseTypes.js';
import { notify } from '../toast.js';

const props = defineProps({
  property: { type: Object, required: true },
  rules: { type: Array, required: true }, // this property's current price rules
});
const emit = defineEmits(['close', 'saved']);

const general = reactive(Object.fromEntries(HOUSE_TYPES.map((t) => [t.value, ''])));
const floorRows = ref([]);
for (const r of props.rules) {
  if (r.floor_number === null) general[r.unit_type] = String(Number(r.monthly_rent));
  else floorRows.value.push({ unit_type: r.unit_type, floor_number: String(r.floor_number), monthly_rent: String(Number(r.monthly_rent)) });
}

const apply = ref(true);
const error = ref('');
const saving = ref(false);

const addFloorRow = () => floorRows.value.push({ unit_type: 'single', floor_number: '', monthly_rent: '' });
const removeFloorRow = (i) => floorRows.value.splice(i, 1);

async function save() {
  const rules = [];
  for (const t of HOUSE_TYPES) {
    if (String(general[t.value]).trim() !== '') rules.push({ unit_type: t.value, floor_number: null, monthly_rent: String(general[t.value]) });
  }
  for (const r of floorRows.value) {
    if (String(r.floor_number).trim() === '' || String(r.monthly_rent).trim() === '') {
      error.value = 'Each floor-specific price needs a floor number and a price. Remove the row if you do not need it.';
      return;
    }
    rules.push({ unit_type: r.unit_type, floor_number: Number(r.floor_number), monthly_rent: String(r.monthly_rent) });
  }
  saving.value = true;
  error.value = '';
  try {
    const r = await api(`/properties/${props.property.id}/pricing`, { method: 'PUT', body: { rules, apply_to_vacant: apply.value } });
    notify.success(
      `Prices saved for ${props.property.name}.${apply.value ? ` ${r.updated_units} vacant house${r.updated_units === 1 ? '' : 's'} updated.` : ''}`
    );
    emit('saved');
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="`Prices: ${property.name}`" wide @close="emit('close')">
    <div v-if="error" class="banner error" role="alert">{{ error }}</div>
    <p class="muted">Set the monthly rent for each house type. These fill in automatically when you add a house or a tenant. Leave a type blank if you do not have it.</p>

    <div class="form-grid">
      <label v-for="t in HOUSE_TYPES" :key="t.value" class="field">{{ t.label }} (KES)
        <input v-model="general[t.value]" inputmode="decimal" placeholder="Not set" />
      </label>
    </div>

    <h2 style="margin-top: 8px">Floor-specific prices</h2>
    <p class="muted"><small>For example, 2 bedrooms on floor 3 cost more. A floor price wins over the price above.</small></p>
    <div v-for="(r, i) in floorRows" :key="i" class="form-grid" style="grid-template-columns: 1.3fr .8fr 1fr auto; align-items: end">
      <label class="field">Type
        <select v-model="r.unit_type"><option v-for="t in HOUSE_TYPES" :key="t.value" :value="t.value">{{ typeLabel(t.value) }}</option></select>
      </label>
      <label class="field">Floor <input v-model="r.floor_number" type="number" inputmode="numeric" /></label>
      <label class="field">Price <input v-model="r.monthly_rent" inputmode="decimal" /></label>
      <button class="btn icon-btn" style="margin-bottom: 14px" aria-label="Remove price" @click="removeFloorRow(i)"><Icon name="trash" :size="16" /></button>
    </div>
    <button class="btn sm" @click="addFloorRow"><Icon name="plus" :size="15" />Add floor price</button>

    <label class="check-row" style="margin-top: 14px">
      <input v-model="apply" type="checkbox" />
      <span class="grow">Also update the rent of vacant houses to match these prices</span>
    </label>

    <footer>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :class="{ busy: saving }" :disabled="saving" @click="save">Save prices</button>
    </footer>
  </Modal>
</template>
