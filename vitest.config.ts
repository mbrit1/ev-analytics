import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import type { PluginOption } from 'vite'

async function getCloudflarePlugins(): Promise<PluginOption[]> {
  if (process.env.VITEST) {
    return []
  }

  const { cloudflare } = await import('@cloudflare/vite-plugin')
  return [cloudflare()]
}

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
    }),
    // Cloudflare's Vite plugin opens an inspector port which is not permitted in
    // the sandboxed Vitest runtime. It is only needed for dev/build workflows.
    ...(await getCloudflarePlugins())
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
}))
