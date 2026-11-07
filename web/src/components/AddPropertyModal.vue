<script setup>
import { reactive, ref } from 'vue';
import Modal from './Modal.vue';
import { api } from '../api.js';
import { notify } from '../toast.js';

const emit = defineEmits(['close', 'saved']);
const form = reactive({ name: '', address: '', city: '', total_floors: '' });
const error = ref('');
const saving = ref(false);

async function save() {
  if (!form.name.trim() || !form.address.trim()) { error.value = 'Please enter the property name and address.'; return; }
  saving.value = true;
  error.value = '';
  try {
    const created = await api('/properties', {
      method: 'POST',
      body: { name: form.name, address: form.address, city: form.city || undefined, total_floors: form.total_floors ? Number(form.total_floors) : undefined },
    });
    notify.success(`${form.name} was added. Now add its houses.`);
    emit('saved', created);
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal title="Add property" @close="emit('close')">
    <div v-if="error" class="banner error" role="alert">{{ error }}</div>
    <label class="field">Name <input v-model="form.name" placeholder="e.g. Sunrise Apartments" @keyup.enter="save" /></label>
    <label class="field">Address <input v-model="form.address" /></label>
    <div class="form-grid">
      <label class="field">City <input v-model="form.city" /></label>
      <label class="field">Floors <input v-model="form.total_floors" type="number" min="1" inputmode="numeric" /></label>
    </div>
    <footer>
      <button class="btn" @click="emit('close')">Cancel</button>
      <button class="btn primary" :class="{ busy: saving }" :disabled="saving" @click="save">Save property</button>
    </footer>
  </Modal>
</template>
