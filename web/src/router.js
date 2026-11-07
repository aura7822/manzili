import { reactive } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { canManage, isLoggedIn } from './api.js';

export const nav = reactive({ loading: false });

const routes = [
  { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/p/:slug', component: () => import('./views/Pay.vue'), meta: { public: true } },
  { path: '/', component: () => import('./views/Dashboard.vue') },
  { path: '/units', component: () => import('./views/Units.vue') },
  { path: '/tenants', component: () => import('./views/Tenants.vue') },
  { path: '/broadcast', component: () => import('./views/Broadcast.vue'), meta: { manage: true } },
  { path: '/archives', component: () => import('./views/Archives.vue'), meta: { manage: true } },
  { path: '/logs', component: () => import('./views/Logs.vue'), meta: { manage: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  if (!to.meta.public && !isLoggedIn()) return '/login';
  if (to.path === '/login' && isLoggedIn()) return '/';
  if (to.meta.manage && !canManage()) return '/';
  nav.loading = true;
});
router.afterEach(() => { nav.loading = false; });
router.onError(() => { nav.loading = false; });

export default router;
