import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ローカル開発: Vite(5173) が /api を wrangler dev(8787) に中継する
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
