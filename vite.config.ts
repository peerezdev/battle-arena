import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Permite servir el preview a través de túneles efímeros (cloudflared) para
  // probar desde el móvil/remoto. Solo afecta al servidor de preview local.
  preview: { allowedHosts: true },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
