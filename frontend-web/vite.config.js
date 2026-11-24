import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Biarkan listen ke semua network interface di VPS
    port: 5173, 
    strictPort: false, 
    open: false, 
    proxy: {
      '/api': {
        // SESUDAH: Ganti dengan IP VPS Backend kamu
        target: 'http://202.169.232.241:8017',
        changeOrigin: true,
        secure: false,
      }
    }
  },
})