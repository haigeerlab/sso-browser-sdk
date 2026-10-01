import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'vue',
  base: '/app-a/',
  plugins: [vue()],
  build: { outDir: '../build/vue', emptyOutDir: true },
});
