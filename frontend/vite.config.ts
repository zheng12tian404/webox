import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: { env: Record<string, string | undefined> };

const target = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8080';
const port = Number(process.env.VITE_DEV_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    host: '0.0.0.0',
    proxy: {
      '/api': { target, changeOrigin: true, headers: { Origin: 'http://localhost:5173' } },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
