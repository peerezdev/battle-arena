import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Permite servir el preview a través de túneles (ngrok/cloudflared) para probar
  // desde el móvil/remoto. Solo afecta al servidor de preview local.
  // El `proxy` reenvía las rutas del backend (+ WS) al backend local (9090), para
  // servir frontend y backend por el MISMO origen (dominio ngrok estable).
  preview: {
    allowedHosts: true,
    proxy: {
      '/gacha': { target: 'http://localhost:9090', changeOrigin: true },
      '/auth': { target: 'http://localhost:9090', changeOrigin: true },
      '/users': { target: 'http://localhost:9090', changeOrigin: true },
      '/matches': { target: 'http://localhost:9090', changeOrigin: true },
      '/elo': { target: 'http://localhost:9090', changeOrigin: true },
      '/leaderboard': { target: 'http://localhost:9090', changeOrigin: true },
      '/health': { target: 'http://localhost:9090', changeOrigin: true },
      '/ws': { target: 'http://localhost:9090', ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    alias: {
      // Evita que el subpath de Privy/Solana (que requiere @solana-program/memo
      // como peer dep opcional no instalado) se resuelva durante los tests unitarios.
      '@privy-io/react-auth/solana': path.resolve(
        __dirname,
        'src/__mocks__/@privy-io/react-auth/solana.ts',
      ),
    },
  },
})
