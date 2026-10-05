import { defineConfig } from 'vitest/config'
import viteReact from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [viteReact()],
  resolve: {
    alias: {
      '~': srcDir,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globalSetup: ['./tests/global-setup.mjs'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/shared/**', 'src/server/**', 'src/client/**', 'src/components/**'],
      exclude: ['src/**/*.d.ts', 'src/routes/**'],
    },
    // Integration tests against MySQL need more time for seeding.
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    fileParallelism: false,
  },
})
