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
    // Cloudflare's Vite plugin opens an inspector port which is not permitted in
    // the sandboxed Vitest runtime. It is only needed for dev/build workflows.
    ...(process.env.VITEST ? [] : [cloudflare()])
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
