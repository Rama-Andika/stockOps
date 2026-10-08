import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  server: {
    host: true,
    port: 3000,
    allowedHosts: true,
  },
  resolve: {
    alias: {
      '~': srcDir,
    },
  },
  // Version and build time shown to the operator in Pengaturan (src/shared/app-version.ts).
  //
  // package.json is read with `readFileSync` rather than `import pkg from './package.json'`:
  // this config file is also type-checked by `npm run typecheck`, and a JSON import here would
  // depend on JSON-module semantics that differ between the bundler and tsc.
  //
  // `define` performs a plain TEXTUAL substitution, so both values must be JSON.stringify'd —
  // without the quotes the build would emit a bare identifier and fail.
  define: {
    __APP_VERSION__: JSON.stringify(
      (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
        version: string
      }).version,
    ),
    // Evaluated once, when this config is loaded — i.e. per `vite build` or per `vite dev` start.
    // scripts/stamp-sw.mjs stamps its own timestamp into dist/client/sw.js a moment later; see the
    // note in src/shared/app-version.ts on why the two are allowed to differ.
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
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
