<script setup lang="ts">
import type { ProgressProps } from '@bitrix24/b24ui-nuxt'
import type { IStep } from '#shared/types/base'
import { PLACEMENT_MIN_HEIGHT } from '~/utils/placement'
import type { B24Frame } from '@bitrix24/b24jssdk'
import { ref, onMounted } from 'vue'
import { sleepAction } from '~/utils/sleep'
import Logo from '~/components/Logo.vue'
import { B24_BOUND_EVENTS, buildEventBindCalls, isBindableHandlerUrl, type EventBinding } from '~/utils/b24EventBind'

const { t, locales: localesI18n, setLocale } = useI18n()

definePageMeta({
  layout: 'index-page'
})

// Via the page store + watchEffect so the title follows the portal's locale, which initLang only
// resolves after the frame handshake — a value captured at setup would freeze on the prerendered one.
const page = usePageStore()
watchEffect(() => {
  page.title = t('page.install.seo.title')
})

/**
 * Public base URL the app is served from, used to build the UF handler URL.
 * Derived from the app's configured baseURL — NOT from the current pathname: the install page
 * answers on both `/install` and `/install/`, and slicing the pathname would turn the trailing-slash
 * form into `<host>/install/handler/...` (a 404 handler registered silently).
 */
function getBaseUrl(): string {
  const base = useRuntimeConfig().app?.baseURL || '/'
  return `${window.location.origin}${base.endsWith('/') ? base : `${base}/`}`
}

// region Init ////
// The page is prerendered, so nothing here may touch `window` or the portal frame at setup —
// both are resolved client-side in onMounted below.
const { $logger, initLang, processErrorGlobal } = useAppInit('Install')
const { init: initB24Frame } = useB24()
let $b24: null | B24Frame = null

const confetti = useConfetti()


const progressColor = ref<ProgressProps['color']>('air-primary')
const progressValue = ref<null | number>(null)
// endregion ////

// region Steps ////
const steps = ref<Record<string, IStep>>({
  init: {
    caption: t('page.install.step.init.caption'),
    action: makeInit
  },
  demo: {
    caption: t('page.install.step.demo.caption'),
    action: async () => {
      return sleepAction(1000)
    }
  },
  events: {
    caption: t('page.install.step.events.caption'),
    action: async () => {
      // Subscribe the server to the portal's outgoing events. Without this ONAPPUNINSTALL is never
      // delivered, so removing the app would leave the customer's credentials with us forever and
      // the server would never learn the portal is gone.
      const handlerUrl = `${getBaseUrl()}api/b24/events`
      if (!isBindableHandlerUrl(handlerUrl)) {
        throw new Error(`Event handler URL is not absolute (${handlerUrl || 'empty'})`)
      }

      const listed = await $b24!.callMethod('event.get', {})
      const existing = (listed.getData()?.result ?? []) as EventBinding[]
      const { unbind, bind } = buildEventBindCalls(existing, B24_BOUND_EVENTS, handlerUrl)

      // Unbinding is best-effort: a binding that is already gone is exactly the state we want.
      if (unbind.length) {
        await $b24!.callBatch(unbind, false)
      }
      if (bind.length) {
        await $b24!.callBatch(bind, true)
      }
    }
  },
  userFields: {
    caption: t('page.install.step.userFields.caption'),
    action: async () => {
      const typeId = `type_smart_link_${import.meta.dev ? 'dev' : 'prod'}`
      // Derived here (client-side): the handler URL must follow wherever the app is served from.
      const appUrl = getBaseUrl()

      await $b24!.callBatch([
        {
          method: 'userfieldtype.delete',
          params: {
            USER_TYPE_ID: typeId
          }
        },
        {
          method: 'userfieldtype.add',
          params: {
            USER_TYPE_ID: typeId,
            HANDLER: `${appUrl}handler/uf.smart-link`,
            TITLE: `[${import.meta.dev ? 'dev' : 'prod'}] SmartLink`,
            DESCRIPTION: ``,
            OPTIONS: {
              height: PLACEMENT_MIN_HEIGHT
            }
          }
        }
      ], false)
    }
  },
  finish: {
    caption: t('page.install.step.finish.caption'),
    action: makeFinish
  }
})
const stepCode = ref<string>('init' as const)
// endregion ////

// region Actions ////
async function makeInit(): Promise<void> {
  // A short beat so the wizard visibly starts rather than jumping straight to the next step.
  // (This used to also stuff par11/val11 debug data into the step — donor-template scaffolding a
  // Market reviewer would have walked past on a production install page.)
  return sleepAction()
}

async function makeFinish(): Promise<void> {
  progressColor.value = 'air-primary-success'
  progressValue.value = 100

  confetti.fire()
  await sleepAction(3000)

  await $b24!.installFinish()
}

// endregion ////

// region Lifecycle Hooks ////
onMounted(async () => {
  $logger.info('Hi from install page')

  try {
    $b24 = await initB24Frame()
    if (!$b24) {
      throw new FrameUnavailableError('Bitrix24 frame is not available (opened outside a portal)')
    }
    await initLang($b24, localesI18n, setLocale)
    await $b24.parent.setTitle(t('page.install.seo.title'))

    for (const [key, step] of Object.entries(steps.value)) {
      stepCode.value = key
      await step.action()
    }
  } catch (error: any) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: false,
      clearErrorHref: '/install'
    })
  }
})
// endregion ////
</script>

<template>
  <div class="mx-3 flex flex-col items-center justify-center gap-1 h-dvh">
    <Logo
      class="size-[208px]"
      :class="[
        stepCode === 'finish' ? 'text-(--ui-color-accent-main-success)' : 'text-(--ui-color-accent-soft-green-1)'
      ]"
    />
    <B24Progress
      v-model="progressValue"
      size="xs"
      animation="elastic"
      :color="progressColor"
      class="w-1/2 sm:w-1/3"
    />
    <div class="mt-6 flex flex-col items-center justify-center gap-2">
      <ProseH1 class="text-nowrap mb-0">
        {{ $t('page.install.ui.title') }}
      </ProseH1>
      <ProseP small accent="less">
        {{ steps[stepCode]?.caption || '...' }}
      </ProseP>
    </div>
  </div>
</template>
