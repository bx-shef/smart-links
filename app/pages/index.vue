<script setup lang="ts">
import { computed } from 'vue'
import { shortSha, commitUrl } from '~/utils/build'

// Public marketing landing served at '/'. Standalone: no Bitrix24 frame, no portal auth —
// it must render outside a portal. In-portal pages keep their own '*.html' routes.
definePageMeta({
  layout: false
})

const { t } = useI18n()
const config = useRuntimeConfig()

useHead({
  bodyAttrs: { class: 'light light:[--air-theme-bg-color:#ffffff]' }
})
useSeoMeta({
  title: t('landing.seo.title'),
  description: t('landing.seo.description')
})

const commit = computed(() => String(config.public.commitSha || 'dev'))
const build = computed(() => ({ sha: shortSha(commit.value), url: commitUrl(commit.value) }))

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
  <main class="min-h-dvh bg-white text-slate-900">
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
            <span class="flex size-8 items-center justify-center rounded-full bg-slate-900 text-sm text-white">
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

    <!-- Footer -->
    <footer class="border-t border-slate-200">
      <div class="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>{{ $t('landing.footer.publisher') }}</span>
        <a
          v-if="build.sha"
          :href="build.url"
          target="_blank"
          rel="noopener noreferrer"
          class="hover:text-slate-900"
        >
          {{ $t('landing.footer.build') }} {{ build.sha }}
        </a>
      </div>
    </footer>
  </main>
</template>
