import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { contentLocales } from './i18n/i18n.map'

const extraAllowedHosts = (process?.env.NUXT_ALLOWED_HOSTS?.split(',').map((s: string) => s.trim()).filter(Boolean)) ?? []

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // NOTE: '@bitrix24/b24jssdk-nuxt' is deliberately NOT used (and no longer a dependency) — its
  // plugin imports the B24 SDK statically, which lands in the entry chunk the public landing loads.
  // The frame is created lazily by composables/useB24 (dynamic import), as in the reference app.
  // The invariant is TRANSITIVE: nothing reachable from app.vue, a layout, global middleware or a
  // plugin may import '@bitrix24/b24jssdk' for a value (type-only imports erase and are fine).
  modules: [
    '@bitrix24/b24ui-nuxt',
    '@nuxt/eslint',
    '@nuxtjs/i18n',
    '@pinia/nuxt'
  ],
  devtools: { enabled: false },
  // No global baseURL: the public landing is served at '/', in-portal pages live at /app,
  // /install, /handler/… and /slider/…, and /api/* answers without a redirect (the served /
  // Black Hole deploy target). In-portal registration is unaffected — the install page derives
  // the UF handler URL from window.location. NOTE: tools/fix-paths keys off a 'dev-folder'
  // marker the build never emits, so it is inert; the archive flow needs its own fix + a
  // live-portal check — see docs/SERVER_MIGRATION.md.

  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      b24FormId: '',
      b24FormSecret: '',
      b24FormLoaderScript: '',
      // Bitrix24 Market listing code; empty => rating prompt disabled (fail-safe).
      b24MarketCode: '',
      // Public origin the app is served from, e.g. 'https://smart-links.example.com'. Used for the
      // landing's canonical/og:url. Empty => those tags are omitted (an absolute URL is required
      // and guessing one is worse than having none).
      siteUrl: '',
      // Build commit sha ('dev' locally); overridden by NUXT_PUBLIC_COMMIT_SHA at build/runtime.
      commitSha: 'dev'
    }
  },
  devServer: {
    loadingTemplate: () => {
      return readFileSync('./template/devServer-loading.html', 'utf-8')
    }
  },
  compatibilityDate: '2025-07-16',

  // Legacy in-portal URLs redirect to the new routes, so a portal registered against an older
  // build keeps working instead of 404-ing on a UF handler (which fails silently, inside an iframe).
  //
  // The old build set `app.baseURL: '/smart-link/'` and emitted '*.html' pages, so the real legacy
  // URLs carry that prefix — the unprefixed forms are kept only for a root-based archive drop.
  // NOTE '/index.html' is deliberately absent: under the new layout that is the LANDING's own
  // filename, and redirecting it to /app would send the public homepage alias to a noindex page.
  //
  // 308, not 301: the portal opens in-portal pages with POST, and 301/302 let a client rewrite that
  // to GET. 308 preserves the method and body.
  routeRules: {
    '/smart-link/index.html': { redirect: { to: '/app', statusCode: 308 } },
    '/smart-link/install.html': { redirect: { to: '/install', statusCode: 308 } },
    '/smart-link/handler/uf.smart-link.html': { redirect: { to: '/handler/uf.smart-link', statusCode: 308 } },
    '/smart-link/slider/app-options.html': { redirect: { to: '/slider/app-options', statusCode: 308 } },
    '/smart-link/slider/feedback.html': { redirect: { to: '/slider/feedback', statusCode: 308 } },
    '/install.html': { redirect: { to: '/install', statusCode: 308 } },
    '/handler/uf.smart-link.html': { redirect: { to: '/handler/uf.smart-link', statusCode: 308 } },
    '/slider/app-options.html': { redirect: { to: '/slider/app-options', statusCode: 308 } },
    '/slider/feedback.html': { redirect: { to: '/slider/feedback', statusCode: 308 } }
  },

  nitro: {
    // Pinned rather than left to the default: the whole deploy story (one process serving the
    // landing, the in-portal pages and /api/*) depends on this preset, so it should not follow a
    // default that could change or be overridden by a platform env var.
    preset: 'node-server',
    prerender: {
      // Landing + in-portal pages as real static HTML (the landing needs indexable content;
      // in-portal pages are static shells that init the B24 frame client-side). /install is the
      // B24 install handler — prerendered so a HEAD request returns 200 for URL validation.
      routes: ['/', '/app', '/install', '/handler/uf.smart-link', '/slider/app-options', '/slider/feedback']
    }
  },
  hooks: {
    // Splitting the SDK out of the entry chunk keeps it off the landing's critical path, but Nuxt
    // still emits `<link rel="prefetch">` for it, so a visitor who will never open a portal still
    // downloads ~300 KB on idle. The landing has no in-app navigation to speed up (it renders no
    // NuxtLink), so route prefetching buys nothing here — drop the hints and let each in-portal
    // page fetch its own chunks, which it does anyway on first paint.
    'build:manifest'(manifest) {
      for (const entry of Object.values(manifest)) {
        entry.prefetch = false
      }
    }
  },

  vite: {
    plugins: [
      tailwindcss()
    ],
    server: {
      // Fix: "Blocked request. This host is not allowed" when using tunnels like ngrok
      allowedHosts: [ ...extraAllowedHosts ]
      // Optionally set HMR host if needed behind proxy:
      // hmr: { protocol: 'wss', host: 'whale-viable-wasp.ngrok-free.app', port: 443 }
    }
  },
  i18n: {
    detectBrowserLanguage: false,
    strategy: 'no_prefix',
    langDir: 'locales',
    locales: contentLocales,
    defaultLocale: 'ru'
  },
  b24ui: {
    colorMode: false
  }
})
