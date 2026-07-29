import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit project for pure functions in app/utils (+ shared) and the composables that do not need a
// component instance. Node env, no Nuxt runtime. A `nuxt` project (components/pages via
// @nuxt/test-utils + happy-dom) is still outstanding — see docs/PROJECT_MAP.md G7.
export default defineConfig({
  // Nuxt replaces these at build time; outside Nuxt they are undefined, which silently sends
  // `useB24().init()` down its server branch and makes its tests assert nothing. Pinning the
  // client branch is safe here because the only other reader, the global slider middleware, is
  // not exercised by this project.
  define: {
    'import.meta.client': 'true',
    'import.meta.server': 'false'
  },
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
