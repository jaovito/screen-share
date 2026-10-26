import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const envDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  envDir,
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: Number(loadEnv(mode, envDir, 'VIEWER_').VIEWER_PORT ?? 5173),
    strictPort: true,
  },
  preview: { host: '127.0.0.1', port: 5273, strictPort: true },
}));
