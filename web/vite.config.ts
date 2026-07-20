import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api -> the Fastify API so the browser makes same-origin
// calls (no CORS needed in development). In production, set VITE_API_BASE_URL
// to the API origin, or serve this build behind the same host under /api.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
