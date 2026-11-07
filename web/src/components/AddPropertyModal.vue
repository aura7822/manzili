<script setup>
import { computed, reactive, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api.js';
import { notify } from '../toast.js';

const props = defineProps({ property: { type: Object, default: null } });
const emit = defineEmits(['close', 'saved']);
const isEdit = computed(() => Boolean(props.property));
const form = reactive({ name: '', address: '', city: '', total_floors: '' });
const error = ref('');
const saving = ref(false);

function resetForm() {
  form.name = props.property?.name ?? '';
  form.address = props.property?.address ?? '';
  form.city = props.property?.city ?? '';
  form.total_floors = props.property?.total_floors != null ? String(props.property.total_floors) : '';
}

watch(() => props.property, () => resetForm(), { immediate: true });

async function save() {
  if (!form.name.trim() || !form.address.trim()) { error.value = 'Please enter the property name and address.'; return; }
  saving.value = true;
  error.value = '';
  try {
    const payload = {
      name: form.name.trim(),
      address: form.address.trim(),
      city: form.city.trim() || undefined,
      total_floors: form.total_floors ? Number(form.total_floors) : undefined,
    };

    const saved = isEdit.value
      ? await api(`/properties/${props.property.id}`, { method: 'PATCH', body: payload })
      : await api('/properties', { method: 'POST', body: payload });

    notify.success(isEdit.value ? `${saved.name} was updated.` : `${saved.name} was added. Now add its houses.`);
    emit('saved', saved);
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="isEdit ? 'Edit property' : 'Add property'" @close="emit('close')">
    <div v-if="error" class="banner error" role="alert">{{ error }}</div>
    <label class="field">Name <input v-model="form.name" placeholder="e.g. Sunrise Apartments" @keyup.enter="save" /></label>
    <label class="field">Address <input v-model="form.address" /></label>
    <div class="form-grid">
      <label class="field">City <input v-model="form.city" /></label>
      <label class="field">Floors <input v-model="form.total_floors" type="number" min="1" inputmode="numeric" /></label>
    </div>
    <footer>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :class="{ busy: saving }" :disabled="saving" @click="save">{{ isEdit ? 'Save changes' : 'Save property' }}</button>
    </footer>
  </Modal>
</template>
