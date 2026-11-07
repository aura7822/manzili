<script setup>
import { dismissToast, toasts } from '../toast.js';
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast-${t.type}`" role="status" @click="dismissToast(t.id)">
        {{ t.message }}
      </div>
    </TransitionGroup>
  </div>
</template>
