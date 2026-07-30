import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'

import { cloudflare } from "@cloudflare/vite-plugin";
import { createSecurityHeaders } from './scripts/security-headers.mjs'

function cloudflareStaticAssetSecurityHeaders(supabaseUrl: string): Plugin {
  return {
    name: 'cloudflare-static-asset-security-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: createSecurityHeaders(supabaseUrl),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const shouldAnalyze = process.env.ANALYZE === 'true'
  const supabaseUrl = env.VITE_SUPABASE_URL

  const plugins = [react(), tailwindcss(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
    manifest: {
      name: 'EV Analytics',
      short_name: 'EV Analytics',
      description: 'Offline-first EV charging analytics and tariff management',
      theme_color: '#ffffff',
      icons: [
        {
          src: 'pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: 'pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png'
        },
        {
          src: 'pwa-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable'
        }
      ]
    }
  }), cloudflareStaticAssetSecurityHeaders(supabaseUrl), cloudflare({
    // DevTools inspector is optional for this SPA and prevents local dev
    // startup in restricted environments that cannot bind the default port.
    inspectorPort: false,
  })]

  if (shouldAnalyze) {
    plugins.push(
      visualizer({
        filename: 'dist/bundle-stats.json',
        template: 'raw-data',
        gzipSize: true,
        brotliSize: true,
      }) as never,
    )
  }

  return {
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replaceAll('\\', '/')

          if (!normalizedId.includes('/node_modules/')) return

          if (normalizedId.includes('/node_modules/@supabase/')) {
            return 'vendor-supabase'
          }
          if (
            normalizedId.includes('/node_modules/dexie/')
            || normalizedId.includes('/node_modules/dexie-react-hooks/')
          ) {
            return 'vendor-dexie'
          }
          if (normalizedId.includes('/node_modules/lucide-react/')) {
            return 'vendor-ui'
          }
          if (
            normalizedId.includes('/node_modules/zod/')
            || normalizedId.includes('/node_modules/react-hook-form/')
            || normalizedId.includes('/node_modules/@hookform/')
          ) {
            return 'vendor-forms'
          }
          if (
            normalizedId.includes('/node_modules/react/')
            || normalizedId.includes('/node_modules/react-dom/')
            || normalizedId.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react'
          }

          return 'vendor-misc'
        },
      },
    },
  },
  plugins,
}
})
