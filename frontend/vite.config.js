import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server proxies API calls to FastAPI, so no CORS setup is needed in development.
const API = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': API, '/health': API } },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { three: ['three', '@react-three/fiber', '@react-three/drei'], charts: ['recharts'] } } },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test-setup.js' },
})
