import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

// Two projects (pattern from the reference app):
//  - `unit`: pure functions in app/utils + server/utils, node env, no Nuxt runtime.
//  - `nuxt`: components/pages via @nuxt/test-utils + happy-dom (tests/nuxt/**).
//
// ⚠ @nuxt/test-utils is PINNED to 4.0.x (package.json): 4.1 pulls h3 v2-rc while Nuxt 4 lives on
// h3 v1 — the reference hit that exact break.
export default defineConfig(async () => ({
  test: {
    projects: [
      {
        // Nuxt replaces this at build time; outside Nuxt it is undefined, which sends
        // `useB24().init()` down its server branch and makes its tests fail for the wrong reason.
        //
        // Only `client` is pinned. `import.meta.server` was pinned too and should not have been:
        // most of this project's files test `server/` code, Nitro reads the same family of flags,
        // and a server util that ever guards on it would have had that guard silently inverted
        // under test.
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
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['tests/nuxt/**/*.test.ts'],
          environment: 'nuxt',
          // Booting the Nuxt test environment cold (alongside the unit project) can exceed the
          // 10s default and flake the whole run — give the setup hook headroom (reference note).
          hookTimeout: 60_000,
          testTimeout: 30_000
        }
      })
    ]
  }
}))
