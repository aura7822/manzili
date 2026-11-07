import { reactive } from 'vue';

export const toasts = reactive([]);
let next = 1;

export function dismissToast(id) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

function show(message, type, ms) {
  const id = next++;
  toasts.push({ id, message, type });
  setTimeout(() => dismissToast(id), ms);
}

export const notify = {
  success: (m) => show(m, 'success', 4000),
  info: (m) => show(m, 'info', 4500),
  warn: (m) => show(m, 'warn', 6500),
  error: (m) => show(m, 'error', 7000),
};
