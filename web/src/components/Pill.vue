<script setup>
import { computed } from 'vue';

const props = defineProps({ status: { type: String, required: true }, dot: Boolean });

import { HOUSE_TYPES } from '../houseTypes.js';

const LABELS = { none: 'No rent due', partial: 'Part paid', ...Object.fromEntries(HOUSE_TYPES.map((t) => [t.value, t.label])) };
const isType = computed(() => HOUSE_TYPES.some((t) => t.value === props.status));
const label = computed(() => LABELS[props.status] ?? props.status.replace('_', ' '));
</script>

<template>
  <span class="pill" :class="isType ? 'pill-type' : `pill-${status}`">
    <i v-if="dot" class="dot" />{{ label }}
  </span>
</template>
