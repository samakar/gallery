import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `/v1/*` from the browser is proxied to the Express API on :3000.
// Dev-only -- prod serves UI + API behind the same origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/v1': 'http://localhost:3000',
    },
  },
});
