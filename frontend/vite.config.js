import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all interfaces (IPv4 + IPv6). Without this, Vite binds only to
    // IPv6 (::1) on Windows, so browsers that resolve "localhost" to the IPv4
    // 127.0.0.1 get "This site can't be reached".
    host: true,
    // Forward all "/api" calls (REST + the /api/events SSE stream) to the
    // backend running on port 3001. Keeps the frontend on plain relative URLs.
    // Use 127.0.0.1 (not "localhost") so the proxy doesn't hit the same
    // IPv6/IPv4 mismatch when reaching the backend.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
