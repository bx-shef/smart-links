<script setup lang="ts">
// Named import, not `import * as locales`: the namespace form drags all ~15 b24ui
// locales into the chunk, and only `ru` is configured.
import { ru } from '@bitrix24/b24ui-nuxt/locale'
import { usePageStore } from '~/stores/page'
import BtnSpinnerIcon from '@bitrix24/b24icons-vue/button-specialized/BtnSpinnerIcon'

// In-portal shell for the app's own pages (/app, /install). <B24App> lives here (not in app.vue)
// so the public landing never pulls in the b24ui provider. Pages prerender fine — B24App is a
// plain provider and needs no portal frame.
const { t } = useI18n()
const slots = defineSlots()

const page = usePageStore()
usePageSeo()

const { processErrorGlobal } = useAppInit('LayoutIndexPage')
const { init: initB24Frame } = useB24()

useHead({
  bodyAttrs: {
    class: `light light:[--air-theme-bg-color:#ffffff]`
  }
})

// The frame is resolved lazily on click, never at setup: a top-level await would run during
// prerender, where there is no portal frame at all.
const makeOpenFeedBack = async () => {
  try {
    const $b24 = await initB24Frame()
    await $b24?.slider.openSliderAppPage({
      place: 'feedback',
      bx24_width: 600,
      bx24_title: t('page.feedback.seo.title')
    })
  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: false,
      clearErrorHref: '/app'
    })
  }
}
</script>

<template>
  <B24App :locale="ru">
    <B24SidebarLayout
      :use-light-content="false"
      :b24ui="{ root: 'overflow-y-hidden' }"
    >
      <template #navbar>
        <B24NavbarSection />
        <B24NavbarSpacer />
        <B24NavbarSection class="flex-row items-center justify-start gap-4">
          <B24Button
            :label="$t('layout.default.navbarHeader.feedback')"
            color="air-secondary-accent"
            size="sm"
            @click="makeOpenFeedBack"
          />
        </B24NavbarSection>
      </template>

      <div v-if="page.isLoading">
        <div role="status" :aria-label="$t('app.loading')" class="cursor-wait isolate absolute z-1000 inset-0 w-full flex flex-row flex-nowrap items-center justify-center h-[400px] min-h-[400px]">
          <BtnSpinnerIcon
            class="text-(--ui-color-design-plain-content-icon-secondary) size-[110px] animate-spin-slow"
            aria-hidden="true"
          />
        </div>
      </div>

      <!-- Content -->
      <div v-show="!page.isLoading">
        <slot />
      </div>

      <template v-if="!!slots['footer'] && !page.isLoading" #content-bottom>
        <slot name="footer" />
      </template>
    </B24SidebarLayout>
  </B24App>
</template>
