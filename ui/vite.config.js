import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => ({
  plugins: [react()],
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: true,
    proxy: {
      '/api': { target: process.env.VITE_CORE_URL || 'http://core-service:8080', changeOrigin: true },
      '/actuator': { target: process.env.VITE_CORE_URL || 'http://core-service:8080', changeOrigin: true }
    }
  },
  define: {
    __CORE_API__: JSON.stringify(process.env.VITE_CORE_URL || 'http://core-service:8080')
  }
}));
