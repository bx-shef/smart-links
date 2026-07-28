import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { contentLocales } from './i18n/i18n.map'

const extraAllowedHosts = (process?.env.NUXT_ALLOWED_HOSTS?.split(',').map((s: string) => s.trim()).filter(Boolean)) ?? []

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@bitrix24/b24ui-nuxt',
    '@bitrix24/b24jssdk-nuxt',
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
