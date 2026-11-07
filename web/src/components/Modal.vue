<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import Icon from './Icon.vue';

defineProps({ title: { type: String, required: true }, wide: Boolean });
const emit = defineEmits(['close']);

const onKey = (e) => e.key === 'Escape' && emit('close');
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="overlay" @mousedown.self="emit('close')">
    <div class="modal card" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title">
      <header>
        <h2>{{ title }}</h2>
        <button class="btn icon-btn" aria-label="Close" @click="emit('close')"><Icon name="x" :size="16" /></button>
      </header>
      <slot />
    </div>
  </div>
</template>
