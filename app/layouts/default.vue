<script setup lang="ts">
import * as locales from '@bitrix24/b24ui-nuxt/locale'
import { usePageStore } from '~/stores/page'
import { useAppInit } from '~/composables/useAppInit'
import BtnSpinnerIcon from '@bitrix24/b24icons-vue/button-specialized/BtnSpinnerIcon'

// region Init ////
const { t, locale } = useI18n()
const slots = defineSlots()

const page = usePageStore()
usePageSeo()

const { processErrorGlobal } = useAppInit('LayoutDefault')
const { init: initB24Frame } = useB24()
// endregion ////

// region Actions ////
// The frame is resolved lazily on click (never at setup): a top-level await would run during
// prerender/SSR, where there is no portal frame.
const makeOpenFeedBack = async () => {
  try {
    const $b24 = await initB24Frame()
    await $b24?.slider.openSliderAppPage(
      {
        place: 'feedback',
        bx24_width: 600,
        bx24_title: t('page.feedback.seo.title')
      }
    )
  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: false,
      clearErrorHref: '/app'
    })
  }
}
// endregion ////
</script>

<template>
  <B24App :locale="locales[locale]">
    <B24SidebarLayout
      :use-light-content="false"
      :b24ui="{
        container: 'px-[22px] lg:px-[22px] lg:pt-0 mt-[12px]'
      }"
    >
      <template #navbar>
        <B24NavbarSection/>
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
      <div class="cursor-wait isolate absolute z-1000 inset-0 w-full flex flex-row flex-nowrap items-center justify-center h-[400px] min-h-[400px]">
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
