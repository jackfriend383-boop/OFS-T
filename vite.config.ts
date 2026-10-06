import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { htmlVars } from './vite.shared';

export default defineConfig({
  // GitHub project pages live under /<repo>/: the deploy workflow sets VITE_BASE=/<repo>/.
  base: process.env.VITE_BASE || '/',
  plugins: [react(), htmlVars()],
  build: {
    target: 'es2022',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
});
