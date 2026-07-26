<script setup lang="ts">
import type { B24Frame } from '@bitrix24/b24jssdk'
import { usePageStore } from '~/stores/page'
import { useAppInit } from '~/composables/useAppInit'
import BtnSpinnerIcon from '@bitrix24/b24icons-vue/button-specialized/BtnSpinnerIcon'

// region Init ////
const { t } = useI18n()
const slots = defineSlots()

const page = usePageStore()
useSeoMeta({
  title: page.title,
  description: page.description
})

const { processErrorGlobal } = useAppInit('LayoutDefault')
const { $initializeB24Frame } = useNuxtApp()
const $b24: B24Frame = await $initializeB24Frame()
// endregion ////

// region Actions ////
const makeOpenFeedBack = async() => {
  try {
    await $b24?.slider.openSliderAppPage(
      {
        place: 'feedback',
        bx24_width: 600,
        bx24_title: t('page.base_feedback.seo.title'),
      }
    )
  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: false,
      clearErrorHref: '/main.html'
    })
  }
}
// endregion ////
</script>

<template>
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
</template>
