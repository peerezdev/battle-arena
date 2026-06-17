import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Permite servir el preview a través de túneles efímeros (cloudflared) para
  // probar desde el móvil/remoto. Solo afecta al servidor de preview local.
  preview: { allowedHosts: true },
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
