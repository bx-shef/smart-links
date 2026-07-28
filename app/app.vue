<script setup lang="ts">
// Root component (not a page): global head only. Pages render via NuxtPage; the b24ui provider
// (<B24App>) lives in the in-portal layouts, so the public landing does not pull it in.
// No blanket <ClientOnly> — pages prerender to real HTML (indexable landing); the Bitrix24 frame
// is initialised client-side inside each in-portal page (onMounted).
//
// The document language comes from the i18n locale config, NOT from the b24ui locale bundle:
// importing that here would put it (and the provider it belongs to) in the landing's chunk.
const { locale, locales, defaultLocale } = useI18n()
const current = computed(() => locales.value.find(l => l.code === locale.value))
const lang = computed(() => current.value?.language || current.value?.code || defaultLocale)
const dir = computed(() => current.value?.dir || 'ltr')

useHead({
  htmlAttrs: { lang, dir }
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
