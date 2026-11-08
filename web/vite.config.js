import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  base: '/',
  test: { environment: 'jsdom', include: ['test/**/*.test.js'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
