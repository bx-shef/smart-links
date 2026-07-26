import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit project for pure functions in app/utils (+ shared). Node env, no Nuxt runtime.
// A `nuxt` project (components/pages via @nuxt/test-utils) is added later — see
// docs/PROJECT_MAP.md G7.
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '#shared': fileURLToPath(new URL('./shared', import.meta.url))
    }
  },
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/nuxt/**']
  }
})
