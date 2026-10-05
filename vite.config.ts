import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  server: {
    host: true,
    port: 3000,
  },
  resolve: {
    alias: {
      '~': srcDir,
    },
  },
  plugins: [
    tailwindcss(),
    // TanStack Start runs as an SPA (offline-first); server functions
    // remain active for synchronization to MySQL.
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    // React plugin MUST come after Start plugin.
    viteReact(),
  ],
})
