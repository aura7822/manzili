<script setup>
defineProps({ name: { type: String, required: true }, size: { type: Number, default: 20 } });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="icon">
    <template v-if="name === 'dashboard'"><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></template>
    <template v-else-if="name === 'units'"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4" /></template>
    <template v-else-if="name === 'tenants'"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14c2.8 0 5 2.2 5 5" /></template>
    <template v-else-if="name === 'broadcast'"><path d="M3 11v3a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z" /><path d="M17 9a4 4 0 0 1 0 6" /></template>
    <template v-else-if="name === 'archive'"><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" /></template>
    <template v-else-if="name === 'logs'"><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></template>
    <template v-else-if="name === 'refresh'"><path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4" /><path d="M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5v14M5 12h14" /></template>
    <template v-else-if="name === 'qr'"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4" /></template>
    <template v-else-if="name === 'bell'"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></template>
    <template v-else-if="name === 'logout'"><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M16 8l4 4-4 4M20 12H9" /></template>
    <template v-else-if="name === 'check'"><path d="M5 12.5l4.5 4.5L19 7.5" /></template>
    <template v-else-if="name === 'search'"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></template>
    <template v-else-if="name === 'x'"><path d="M6 6l12 12M18 6L6 18" /></template>
    <template v-else-if="name === 'send'"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" /></template>
    <template v-else-if="name === 'wrench'"><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-2.6-.6-.6-2.6z" /></template>
    <template v-else-if="name === 'eye'"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></template>
    <template v-else-if="name === 'eyeoff'"><path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.4 7.8A17 17 0 0 0 2 12s3.6 6 10 6a9.6 9.6 0 0 0 4-.9M9.9 9.9a3 3 0 0 0 4.2 4.2" /></template>
    <template v-else-if="name === 'calendar'"><rect x="3" y="5" width="18" height="16" /><path d="M3 10h18M8 3v4M16 3v4" /></template>
    <template v-else-if="name === 'left'"><path d="M15 5l-7 7 7 7" /></template>
    <template v-else-if="name === 'right'"><path d="M9 5l7 7-7 7" /></template>
    <template v-else-if="name === 'tag'"><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.2" /></template>
    <template v-else-if="name === 'trash'"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></template>
    <template v-else-if="name === 'home'"><path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6" /></template>
    <template v-else-if="name === 'edit'"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" /></template>
  </svg>
</template>
