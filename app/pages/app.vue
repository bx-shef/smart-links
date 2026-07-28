<script setup lang="ts">
import type { B24Frame } from '@bitrix24/b24jssdk'
import { onMounted, onUnmounted } from 'vue'
import { EnumCrmEntityType } from '@bitrix24/b24jssdk'

const { t, locales: localesI18n, setLocale } = useI18n()
const page = usePageStore()

definePageMeta({
  layout: 'index-page'
})
useHead({
  title: t('page.index.seo.title')
})

// region Init ////
const { initApp, b24Helper, processErrorGlobal } = useAppInit('IndexPage')
const { $initializeB24Frame } = useNuxtApp()
let $b24: null | B24Frame = null

// Rating prompt (inert unless NUXT_PUBLIC_B24_MARKET_CODE is set).
const { isEnabled: isRatingEnabled, isOpen: isRatingOpen, maybePrompt, openMarket, markReviewed, dismiss } = useAppRating()
// endregion ////

// region Actions ////
const makeOpenDealUfList = async() => {
  try {
    if (!$b24) {
      return
    }

    const url = (b24Helper.value?.b24SpecificUrl.UfList || '').toString()
    const path = $b24.slider.getUrl(url)
    path?.searchParams.set('moduleId', 'crm')
    path?.searchParams.set('entityId', EnumCrmEntityType.deal)

    await $b24?.slider.openPath(
      path,
      950
    )
  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: false
    })
  }
}
// endregion ////

// region Lifecycle Hooks ////
onMounted(async () => {
  page.isLoading = true

  try {
    $b24 = await $initializeB24Frame()
    await initApp($b24, localesI18n, setLocale)

    await $b24.parent.setTitle(t('page.index.seo.title'))

    // Rating prompt is best-effort — its failure must not crash the page. The show decision
    // is made server-side (GET /api/app-rating); inert without a portal / DB / Market code.
    if (isRatingEnabled) {
      try {
        await maybePrompt($b24)
      } catch (error) {
        console.error('appRating: prompt failed', error)
      }
    }
  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: true,
      clearErrorHref: '/app'
    })
  } finally {
    page.isLoading = false
  }
})

onUnmounted(() => {
  $b24?.destroy()
})
// endregion ////
</script>

<template>
  <AdviceCenter>
    <B24Advice
      class="w-full max-w-[550px]"
      :b24ui="{ descriptionWrapper: 'w-full' }"
      :avatar="{ src: 'avatar/assistant.png' }"
    >
      <ProseH3>{{ $t('page.index.message.title') }}</ProseH3>
      <ProseP>{{ $t('page.index.message.line1') }}</ProseP>
      <ProseP>{{ $t('page.index.message.line2') }}</ProseP>
    </B24Advice>

    <B24Separator class="my-4" />
    <div class="flex flex-row flex-wrap items-center justify-center gap-2">
      <B24Button
        rounded
        :label="$t('page.index.menu.openDealUf')"
        color="air-secondary-accent-2"
        @click.stop="makeOpenDealUfList"
      />
    </div>

    <AppRatingModal
      v-if="isRatingEnabled"
      v-model:open="isRatingOpen"
      @rate="openMarket"
      @reviewed="markReviewed"
      @later="dismiss"
    />
  </AdviceCenter>
</template>
