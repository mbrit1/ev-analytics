import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { cloudflare } from "@cloudflare/vite-plugin"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
    }),
    cloudflare()
  ],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
})
