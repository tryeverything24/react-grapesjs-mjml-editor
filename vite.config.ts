// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import netlify from "@netlify/vite-plugin";

export default defineConfig({
  plugins: [react(), netlify()],
  base: '/React-grapesjs-mjml/',        // must match your repo name
  build: { outDir: 'dist', target: 'esnext' },
});
