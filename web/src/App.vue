<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import Icon from './components/Icon.vue';
import Toasts from './components/Toasts.vue';
import { canManage, initials, logout, session } from './api.js';
import { startLive, stopLive } from './live.js';
import { nav } from './router.js';

const route = useRoute();
const bare = computed(() => route.meta.public);

const links = computed(() => [
  ['/', 'Control Panel', 'dashboard', 'Panel'],
  ['/units', 'Units', 'units', 'Units'],
  ['/tenants', 'Tenants', 'tenants', 'Tenants'],
  ...(canManage()
    ? [['/broadcast', 'Broadcast', 'broadcast', 'Send'], ['/archives', 'Archives', 'archive', 'Archive'], ['/logs', 'Logs', 'logs', 'Logs']]
    : []),
]);

// One shared live connection for the whole signed-in app (keeps open pages fresh).
watch(() => session.token, (t) => (t ? startLive() : stopLive()));
onMounted(() => session.token && startLive());
onBeforeUnmount(stopLive);
</script>

<template>
  <div v-if="nav.loading" class="progress" />
  <Toasts />

  <router-view v-if="bare" />
  <div v-else class="shell">
    <aside class="rail" aria-label="Main navigation">
      <div class="brand"><span class="brand-mark"><Icon name="home" :size="22" /></span><span class="label">Property Manager</span></div>
      <nav>
        <router-link v-for="[to, label, icon] in links" :key="to" :to="to" exact-active-class="active" :title="label">
          <Icon :name="icon" :size="22" /><span class="label">{{ label }}</span>
        </router-link>
      </nav>
      <div class="rail-foot">
        <div class="avatar" aria-hidden="true">{{ initials(session.user?.full_name) }}</div>
        <div class="who label"><strong>{{ session.user?.full_name }}</strong><small>{{ session.user?.role }}</small></div>
        <button class="btn sm icon-btn label" aria-label="Sign out" title="Sign out" @click="logout()"><Icon name="logout" :size="17" /></button>
      </div>
    </aside>

    <header class="mobile-bar">
      <div class="brand"><span class="brand-mark"><Icon name="home" :size="18" /></span>Property Manager</div>
      <button class="btn sm icon-btn" aria-label="Sign out" @click="logout()"><Icon name="logout" :size="17" /></button>
    </header>

    <main class="main"><router-view /></main>

    <nav class="bottom-nav" aria-label="Main navigation">
      <router-link v-for="[to, label, icon, short] in links" :key="to" :to="to" exact-active-class="active" :aria-label="label">
        <Icon :name="icon" :size="22" />{{ short }}
      </router-link>
    </nav>
  </div>
</template>
