<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import Icon from './components/Icon.vue';
import Toasts from './components/Toasts.vue';
import { canManage, initials, logout, session } from './api.js';
import { startLive, stopLive } from './live.js';
import { nav } from './router.js';
import { getLanguage, setLanguage, t } from './i18n.js';

const route = useRoute();
const bare = computed(() => route.meta.public);

const links = computed(() => [
  ['/', t('controlPanel'), 'dashboard', t('panel')],
  ['/units', t('units'), 'units', t('units')],
  ['/tenants', t('tenants'), 'tenants', t('tenants')],
  ...(canManage()
    ? [['/broadcast', 'Broadcast', 'broadcast', 'Send'], ['/archives', 'Archives', 'archive', 'Archive'], ['/logs', t('logs'), 'logs', t('logs')]]
    : []),
]);

const currentLang = computed(() => getLanguage());
const toggleLanguage = () => setLanguage(currentLang.value === 'en' ? 'sw' : 'en');

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
      <div class="brand"><span class="brand-mark"><Icon name="home" :size="22" /></span><span class="label">Manzili®</span></div>
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
      <button class="btn sm label" style="margin-top: 10px" @click="toggleLanguage">
        {{ currentLang === 'en' ? 'Swahili' : 'English' }}
      </button>
    </aside>

    <header class="mobile-bar">
      <div class="brand"><span class="brand-mark"><Icon name="home" :size="18" /></span>Manzili Mkononi®</div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="btn sm" @click="toggleLanguage">{{ currentLang === 'en' ? 'SW' : 'EN' }}</button>
        <button class="btn sm icon-btn" aria-label="Sign out" @click="logout()"><Icon name="logout" :size="17" /></button>
      </div>
    </header>

    <main class="main"><router-view /></main>

    <nav class="bottom-nav" aria-label="Main navigation">
      <router-link v-for="[to, label, icon, short] in links" :key="to" :to="to" exact-active-class="active" :aria-label="label">
        <Icon :name="icon" :size="22" />{{ short }}
      </router-link>
    </nav>
  </div>
</template>
