<script setup lang="ts">
import { ref } from 'vue'
// Named import, not `import * as locales`: the namespace form drags all ~15 b24ui
// locales into the chunk, and only `ru` is configured.
import { ru } from '@bitrix24/b24ui-nuxt/locale'
import type { NuxtError } from '#app'

/**
 * @todo add B24Error component
 */
// Nuxt renders this INSTEAD of app.vue, so the layouts' <B24App> never wraps it — this page has to
// provide the b24ui context itself or its components fall back to the English default locale and
// lose toasts/tooltips/overlays.
const { t } = useI18n()

useHead({
  bodyAttrs: { class: 'light' }
})

const props = defineProps({
  // eslint-disable-next-line vue/require-default-prop
  error: Object as () => NuxtError
})

const errorBase = useError()
console.error(errorBase.value)

const errorData = ref({
  code: props.error?.statusCode ?? 400,
  title: props.error?.statusMessage ?? t('error.title'),
  description: (props.error?.data as any)?.description || errorBase?.value?.message || '',
  clearErrorIsShow: (props.error?.data as any)?.isShowClearError === true,
  clearErrorHref: (props.error?.data as any)?.clearErrorHref ?? '/app',
  clearErrorTitle: (props.error?.data as any)?.clearErrorTitle ?? t('error.clear'),
  homePageIsHide: (props.error?.data as any)?.homePageIsHide === true,
  // "Home" defaults to the public landing (an error can happen outside a portal); in-portal
  // pages pass their own href via the error data.
  homePageHref: (props.error?.data as any)?.homePageHref ?? '/',
  homePageTitle: (props.error?.data as any)?.homePageTitle ?? t('error.home')
})

const handleError = () => clearError({ redirect: errorData.value.clearErrorHref })
</script>

<template>
  <B24App :locale="ru">
    <div class="my-[24px] py-[24px] flex flex-col justify-center items-center h-[calc(100vh-60px)] backdrop-blur-sm bg-(--ui-color-design-outline-na-bg)">
      <ProseP small accent="less">
        [code: {{ errorData.code }}]
      </ProseP>
      <ProseH1>
        {{ errorData.title }}
      </ProseH1>
      <ProseP
        v-show="errorData.description"
        accent="default"
      >
        {{ errorData.description }}
      </ProseP>
      <div class="my-4 flex flex-col sm:flex-row items-center justify-center gap-[10px] ">
        <B24Button
          v-if="!errorData.homePageIsHide"
          color="air-primary"
          :to="errorData.homePageHref"
          :label="errorData.homePageTitle"
        />
        <B24Button
          v-if="errorData.clearErrorIsShow"
          color="air-secondary"
          :label="errorData.clearErrorTitle"
          @click="handleError"
        />
      </div>
    </div>
  </B24App>
</template>
