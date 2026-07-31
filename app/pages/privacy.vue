<script setup lang="ts">
import { computed } from 'vue'

// Public privacy policy. Standalone like the landing: no Bitrix24 frame, no portal auth, no b24ui —
// the Market listing links here, and a moderator (or a customer's lawyer) must be able to open it
// without a portal, a session or JavaScript.
definePageMeta({
  layout: false
})

const { t } = useI18n()
const config = useRuntimeConfig()

// Rendered only when configured. A privacy policy is a legal surface: a placeholder e-mail or a
// stand-in company name reads as real and is worse than an obvious gap.
const supportEmail = computed(() => String(config.public.supportEmail || '').trim())
const publisherDetails = computed(() => String(config.public.publisherDetails || '').trim())

useSeoMeta({
  title: () => t('privacy.seo.title'),
  description: () => t('privacy.seo.description'),
  ogTitle: () => t('privacy.seo.title'),
  ogDescription: () => t('privacy.seo.description')
})

const sections = computed(() => [
  { key: 'collect', title: t('privacy.collect.title'), body: t('privacy.collect.body') },
  { key: 'store', title: t('privacy.store.title'), body: t('privacy.store.body') },
  { key: 'share', title: t('privacy.share.title'), body: t('privacy.share.body') },
  { key: 'retain', title: t('privacy.retain.title'), body: t('privacy.retain.body') },
  { key: 'protect', title: t('privacy.protect.title'), body: t('privacy.protect.body') },
  { key: 'rights', title: t('privacy.rights.title'), body: t('privacy.rights.body') }
])
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-white text-slate-900">
    <main class="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <NuxtLink to="/" class="text-sm text-slate-500 hover:text-slate-900">
        <span aria-hidden="true">←</span> {{ $t('privacy.back') }}
      </NuxtLink>

      <h1 class="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
        {{ $t('privacy.title') }}
      </h1>
      <p class="mt-2 text-sm text-slate-500">{{ $t('privacy.updated') }}</p>
      <p class="mt-4 leading-relaxed text-slate-600">
        {{ $t('privacy.intro') }}
      </p>

      <section
        v-for="section in sections"
        :key="section.key"
        class="mt-10"
      >
        <h2 class="text-xl font-medium">{{ section.title }}</h2>
        <p class="mt-3 leading-relaxed whitespace-pre-line text-slate-600">{{ section.body }}</p>
      </section>

      <!--
        Gated as a whole, heading included. With the details unset the section rendered a bare
        «Контакты» with nothing under it — which reads as a broken page, not as a deliberate gap,
        and sits right after the paragraph telling the reader to write to the publisher.
      -->
      <section v-if="supportEmail || publisherDetails" class="mt-10">
        <h2 class="text-xl font-medium">{{ $t('privacy.contact.title') }}</h2>
        <p v-if="supportEmail" class="mt-3 leading-relaxed text-slate-600">
          {{ $t('privacy.contact.body') }}
          <a :href="`mailto:${supportEmail}`" class="underline hover:text-slate-900">{{ supportEmail }}</a>
        </p>
        <p v-if="publisherDetails" class="mt-3 leading-relaxed whitespace-pre-line text-slate-600">
          {{ publisherDetails }}
        </p>
      </section>
    </main>

    <footer class="border-t border-slate-200">
      <div class="mx-auto max-w-3xl px-6 py-8 text-sm text-slate-500">
        {{ $t('landing.footer.publisher') }}
      </div>
    </footer>
  </div>
</template>
