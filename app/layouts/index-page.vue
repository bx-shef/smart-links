<script setup lang="ts">
import * as locales from '@bitrix24/b24ui-nuxt/locale'

// In-portal shell. <B24App> lives here (not in app.vue) so the public landing never pulls in the
// b24ui provider. Pages prerender fine — B24App is a plain provider and needs no portal frame.
const { locale } = useI18n()

useHead({
  bodyAttrs: {
    class: `light light:[--air-theme-bg-color:#ffffff]`
  }
})
</script>

<template>
  <B24App :locale="locales[locale]">
    <B24SidebarLayout
      :use-light-content="false"
      :b24ui="{ root: 'overflow-y-hidden' }"
    >
      <!-- Content -->
      <slot />
    </B24SidebarLayout>
  </B24App>
</template>
