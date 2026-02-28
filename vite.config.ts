// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/React-grapesjs-mjml/', // must match your repo name / site subpath
  build: { outDir: 'dist', target: 'esnext' },
});
