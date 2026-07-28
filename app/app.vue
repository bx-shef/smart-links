<script setup lang="ts">
import * as locales from '@bitrix24/b24ui-nuxt/locale'

// Root component (not a page): global head only. Pages render via NuxtPage; the b24ui provider
// (<B24App>) lives in the in-portal layouts, so the public landing does not pull it in.
// No blanket <ClientOnly> — pages prerender to real HTML (indexable landing); the Bitrix24 frame
// is initialised client-side inside each in-portal page (onMounted).
const { locale, defaultLocale } = useI18n()
const lang = computed(() => locales[locale.value]?.code || defaultLocale)
const dir = computed(() => locales[locale.value]?.dir || 'ltr')

useHead({
  htmlAttrs: { lang, dir }
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
