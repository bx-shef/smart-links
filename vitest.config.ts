import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit project for pure functions in app/utils (+ shared) and the composables that do not need a
// component instance. Node env, no Nuxt runtime. A `nuxt` project (components/pages via
// @nuxt/test-utils + happy-dom) is still outstanding — see docs/PROJECT_MAP.md G7.
export default defineConfig({
  // Nuxt replaces this at build time; outside Nuxt it is undefined, which sends
  // `useB24().init()` down its server branch and makes its tests fail for the wrong reason.
  //
  // Only `client` is pinned. `import.meta.server` was pinned too and should not have been: most of
  // this project's files test `server/` code, Nitro reads the same family of flags, and a server
  // util that ever guards on it would have had that guard silently inverted under test.
  define: {
    'import.meta.client': 'true'
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
