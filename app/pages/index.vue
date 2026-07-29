<script setup lang="ts">
import { computed } from 'vue'
import { shortSha, commitUrl } from '~/utils/build'
import { marketListingUrl } from '~/utils/appRating'

// Public marketing landing served at '/'. Standalone: no Bitrix24 frame, no portal auth —
// it must render outside a portal. In-portal pages live under /app, /install, /handler, /slider.
definePageMeta({
  layout: false
})

const { t } = useI18n()
const config = useRuntimeConfig()

// Absolute origin for canonical/og:url. Baked at build time from NUXT_PUBLIC_SITE_URL; when it is
// unset — or not an absolute http(s) URL — every URL-bearing tag is omitted rather than pointing at
// a guessed host. The scheme check matters: a value like "example.com" would resolve RELATIVE to
// the page, making <link rel="canonical"> point at a path that does not exist — worse than no tag,
// which is exactly what omitting an empty value is meant to avoid.
const siteUrl = computed(() => {
  const raw = String(config.public.siteUrl || '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[^/]+/.test(raw) ? raw : ''
})

// Getters (not plain values) so title/description follow a locale change.
useSeoMeta({
  title: () => t('landing.seo.title'),
  description: () => t('landing.seo.description'),
  ogType: 'website',
  ogSiteName: () => t('app.name'),
  ogLocale: 'ru_RU',
  ogTitle: () => t('landing.seo.title'),
  ogDescription: () => t('landing.seo.description'),
  // Same form as the canonical below — two spellings of one URL split link signals.
  ogUrl: () => (siteUrl.value ? `${siteUrl.value}/` : undefined),
  twitterCard: 'summary',
  twitterTitle: () => t('landing.seo.title'),
  twitterDescription: () => t('landing.seo.description')
})

useHead({
  link: () => (siteUrl.value ? [{ rel: 'canonical', href: `${siteUrl.value}/` }] : [])
})

// Market listing, support and legal details — each rendered only when configured. The listing URL
// is built by a tested util rather than inline here: the zone matters (each Bitrix24 zone has its
// own catalogue) and a wrong one sends the visitor to a storefront without the app.
const marketUrl = computed(() => marketListingUrl(
  config.public.b24MarketCode,
  config.public.b24MarketZone
) ?? '')
const supportEmail = computed(() => String(config.public.supportEmail || '').trim())
const publisherDetails = computed(() => String(config.public.publisherDetails || '').trim())

const commit = computed(() => String(config.public.commitSha || 'dev'))
// Only link a real build: 'dev' (local / no NUXT_PUBLIC_COMMIT_SHA) has nothing to point at.
const build = computed(() => (commit.value === 'dev'
  ? null
  : { sha: shortSha(commit.value), url: commitUrl(commit.value) }))

const steps = computed(() => [
  { key: 'step1', title: t('landing.how.step1.title'), text: t('landing.how.step1.text') },
  { key: 'step2', title: t('landing.how.step2.title'), text: t('landing.how.step2.text') },
  { key: 'step3', title: t('landing.how.step3.title'), text: t('landing.how.step3.text') }
])

const features = computed(() => [
  { key: 'search', title: t('landing.features.search.title'), text: t('landing.features.search.text') },
  { key: 'create', title: t('landing.features.create.title'), text: t('landing.features.create.text') },
  { key: 'open', title: t('landing.features.open.title'), text: t('landing.features.open.text') },
  { key: 'targets', title: t('landing.features.targets.title'), text: t('landing.features.targets.text') },
  { key: 'settings', title: t('landing.features.settings.title'), text: t('landing.features.settings.text') },
  { key: 'realtime', title: t('landing.features.realtime.title'), text: t('landing.features.realtime.text') }
])
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-white text-slate-900">
    <main class="flex-1">
    <!-- Hero -->
    <section class="mx-auto max-w-5xl px-6 pt-16 pb-12 sm:pt-24 sm:pb-16">
      <p class="inline-block rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
        {{ $t('landing.hero.badge') }}
      </p>
      <h1 class="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
        {{ $t('landing.hero.title') }}
      </h1>
      <p class="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
        {{ $t('landing.hero.subtitle') }}
      </p>
      <a
        href="#how"
        class="mt-8 inline-block rounded-lg bg-slate-900 px-5 py-3 text-white transition-colors hover:bg-slate-700"
      >
        {{ $t('landing.hero.cta') }}
      </a>
    </section>

    <!-- How it works -->
    <section id="how" class="border-t border-slate-200 bg-slate-50">
      <div class="mx-auto max-w-5xl px-6 py-14 sm:py-20">
        <h2 class="text-2xl font-semibold sm:text-3xl">
          {{ $t('landing.how.title') }}
        </h2>
        <ol class="mt-8 grid gap-6 sm:grid-cols-3">
          <li
            v-for="(step, index) in steps"
            :key="step.key"
            class="rounded-xl border border-slate-200 bg-white p-6"
          >
            <span aria-hidden="true" class="flex size-8 items-center justify-center rounded-full bg-slate-900 text-sm text-white">
              {{ index + 1 }}
            </span>
            <h3 class="mt-4 font-medium">{{ step.title }}</h3>
            <p class="mt-2 text-sm leading-relaxed text-slate-600">{{ step.text }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- Features -->
    <section class="mx-auto max-w-5xl px-6 py-14 sm:py-20">
      <h2 class="text-2xl font-semibold sm:text-3xl">
        {{ $t('landing.features.title') }}
      </h2>
      <div class="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="feature in features"
          :key="feature.key"
          class="rounded-xl border border-slate-200 p-6"
        >
          <h3 class="font-medium">{{ feature.title }}</h3>
          <p class="mt-2 text-sm leading-relaxed text-slate-600">{{ feature.text }}</p>
        </div>
      </div>
    </section>

    </main>

    <!-- Footer sits outside <main> so it is exposed as the page's contentinfo landmark. -->
    <footer class="border-t border-slate-200">
      <div class="mx-auto max-w-5xl px-6 py-8 text-sm text-slate-500">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a
              v-if="marketUrl"
              :href="marketUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="hover:text-slate-900"
            >
              {{ $t('landing.footer.market') }}
            </a>
            <NuxtLink to="/privacy" class="hover:text-slate-900">
              {{ $t('landing.footer.privacy') }}
            </NuxtLink>
            <a
              v-if="supportEmail"
              :href="`mailto:${supportEmail}`"
              class="hover:text-slate-900"
            >
              {{ $t('landing.footer.support') }}
            </a>
          </div>
          <a
            v-if="build"
            :href="build.url"
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-slate-900"
          >
            {{ $t('landing.footer.build') }} {{ build.sha }}
          </a>
        </div>
        <p class="mt-4">{{ $t('landing.footer.publisher') }}</p>
        <p v-if="publisherDetails" class="mt-1 whitespace-pre-line">{{ publisherDetails }}</p>
      </div>
    </footer>
  </div>
</template>
