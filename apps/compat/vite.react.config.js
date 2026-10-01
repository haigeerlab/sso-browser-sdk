import { defineConfig } from 'vite';

export default defineConfig({
  root: 'react',
  base: '/app-b/',
  build: { outDir: '../build/react', emptyOutDir: true },
});
