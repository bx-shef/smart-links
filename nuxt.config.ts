import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { contentLocales } from './i18n/i18n.map'

const extraAllowedHosts = (process?.env.NUXT_ALLOWED_HOSTS?.split(',').map((s: string) => s.trim()).filter(Boolean)) ?? []

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // NOTE: '@bitrix24/b24jssdk-nuxt' is intentionally NOT registered — its plugin imports the
  // B24 SDK statically, which lands in the entry chunk the public landing loads. The frame is
  // created lazily by composables/useB24 (dynamic import), as in the reference app.
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

  // Legacy '*.html' URLs (the pre-rename in-portal paths) redirect to the new routes. Without
  // this a portal still pointed at '/index.html' would silently render the public LANDING inside
  // its iframe, and the other old paths would 404 — both hard to diagnose.
  routeRules: {
    '/index.html': { redirect: { to: '/app', statusCode: 301 } },
    '/install.html': { redirect: { to: '/install', statusCode: 301 } },
    '/handler/uf.smart-link.html': { redirect: { to: '/handler/uf.smart-link', statusCode: 301 } },
    '/slider/app-options.html': { redirect: { to: '/slider/app-options', statusCode: 301 } },
    '/slider/feedback.html': { redirect: { to: '/slider/feedback', statusCode: 301 } }
  },

  nitro: {
    prerender: {
      // Landing + in-portal pages as real static HTML (the landing needs indexable content;
      // in-portal pages are static shells that init the B24 frame client-side). /install is the
      // B24 install handler — prerendered so a HEAD request returns 200 for URL validation.
      routes: ['/', '/app', '/install', '/handler/uf.smart-link', '/slider/app-options', '/slider/feedback']
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
