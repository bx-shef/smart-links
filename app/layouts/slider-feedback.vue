<script setup lang="ts">
// Named import, not `import * as locales`: the namespace form drags all ~15 b24ui
// locales into the chunk, and only `ru` is configured.
import { ru } from '@bitrix24/b24ui-nuxt/locale'
import { usePageStore } from '~/stores/page'
import BtnSpinnerIcon from '@bitrix24/b24icons-vue/button-specialized/BtnSpinnerIcon'

// region Init ////
useHead({
  bodyAttrs: {
    class: `light`
  }
})

// <B24App> lives in the layout (not app.vue) so the public landing skips the b24ui provider.
const slots = defineSlots()

const page = usePageStore()
usePageSeo()
// endregion ////
</script>

<template>
  <B24App :locale="ru">
    <B24SidebarLayout
      :use-light-content="false"
      :b24ui="{
        root: 'overflow-y-hidden',
        container: 'p-[20px] mt-0'
      }"
    >
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

<style scoped>
  .--app {
    scrollbar-gutter: auto;
  }
</style>
