import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';

// Vite configuration keeps the FastAPI backend accessible during local dev and production builds.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_API_BASE_URL ?? 'http://localhost:4100';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
          secure: false
        }
      }
    },
    preview: {
      port: 4173
    },
    build: {
      sourcemap: true
    }
  };
});
