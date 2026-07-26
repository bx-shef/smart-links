<script setup lang="ts">
import type { B24Frame } from '@bitrix24/b24jssdk'
import type { AccordionItem } from '@bitrix24/b24ui-nuxt'
import type { UfSmartLinkType } from '#shared/types/base'
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { EnumCrmEntityTypeId, AjaxError, Type  } from '@bitrix24/b24jssdk'
import { usePageStore } from '~/stores/page'
import { useUserStore } from '~/stores/user'
import { useAppSettingsStore } from '~/stores/appSettings'
import ListIcon from '@bitrix24/b24icons-vue/main/ListIcon'
import CloudErrorIcon from '@bitrix24/b24icons-vue/main/CloudErrorIcon'

/**
 * @todo add page title & description
 */
definePageMeta({
  layout: false
})

const { t, locales: localesI18n, setLocale } = useI18n()
const page = usePageStore()
const toast = useToast()

// region Init ////
const { $logger, moduleId, initApp, destroyB24Helper, usePullClient, startPullClient, processErrorGlobal } = useAppInit('SliderAppOptionsPage')
const appSettings = useAppSettingsStore()
const user = useUserStore()
const { $initializeB24Frame } = useNuxtApp()
let $b24: null | B24Frame = null

const ufCode = ref('')
const ufSmartLink = ref<null | UfSmartLinkType>(null)

const activeInfoItem = ref(['0'])
const infoItems = computed(() => [
  {
    label: t('page.app-options.option.target.title'),
    icon: ListIcon,
    slot: 'target'
  }
] satisfies AccordionItem[])
// endregion ////

// region Actions ////
function loadData() {
  if (!$b24) {
    return
  }

  ufCode.value = $b24.placement.options['ufCode']
  if (!Type.isStringFilled(ufCode.value)) {
    processErrorGlobal(
      new Error(t('page.app-options.error.notUfCodeSet')),
      {
        homePageIsHide: true,
        isShowClearError: false
      }
    )
  }

  $logger.info('Hi from app-options', $b24?.placement)

  // A missing ufCode yields `undefined` (not `null`), so guard on presence of a
  // plain-object config; otherwise seed a fresh, type-correct config.
  const existing = appSettings.configUfListSettings[ufCode.value]
  if (Type.isPlainObject(existing)) {
    ufSmartLink.value = existing as UfSmartLinkType
  } else {
    ufSmartLink.value = {
      ufDestination: '',
      orign: {
        clientFields: {
          companyId: 'companyId',
          contactId: 'contactId',
          myCompanyId: undefined,
          dogovorId: undefined
        },
        isFilterBy: {
          company: false,
          contact: false,
          myCompany: false,
          dogovor: false
        }
      },
      target: {
        entityMode: 'crm',
        entityTypeId: EnumCrmEntityTypeId.deal,
        customFilter: {},
        clientFields: {
          companyId: 'companyId',
          contactId: 'contactId',
          myCompanyId: undefined,
          dogovorId: undefined
        }
      }
    }
  }
}

async function makeSave() {
  if (Type.isNull(ufSmartLink.value)) {
    return
  }

  try {
    page.isLoading = true

    /**
     * @memo persist the edited config into app options
     */
    appSettings.configUfListSettings[ufCode.value] = JSON.parse(JSON.stringify(ufSmartLink.value))

    await appSettings.saveSettings()

    await makeSendPullCommand('reload.options', { from: 'app.options' })
    await makeClose()
  } catch (error) {
    $logger.error(error)

    let title = t('page.app-options.error.title')
    let description = ''

    if (error instanceof AjaxError) {
      title = `[${error.name}] ${error.code} (${error.status})`
      description = `${error.message}`
    } else if (error instanceof Error) {
      description = error.message
    } else {
      description = error as string
    }

    toast.add({
      title: title,
      description,
      color: 'air-primary-alert',
      icon: CloudErrorIcon
    })
  } finally {
    page.isLoading = false
  }
}

async function makeSendPullCommand(command: string, params: Record<string, any> = {}) {
  try {
    $logger.warn('>> pull.send >>>', {
      COMMAND: command,
      PARAMS: params,
      MODULE_ID: moduleId
    })

    await $b24?.callMethod(
      'pull.application.event.add',
      {
        COMMAND: command,
        PARAMS: params,
        MODULE_ID: moduleId
      }
    )
  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: true,
      clearErrorHref: '/slider/app-options.html'
    })
  }
}

async function makeClose() {
  await $b24?.parent.closeApplication()
}

async function makeCancel() {
  await $b24?.parent.closeApplication()
}
// endregion ////

// region Lifecycle Hooks ////
onMounted(async () => {
  try {
    page.isLoading = true

    $b24 = await $initializeB24Frame()
    await initApp($b24, localesI18n, setLocale)

    if( !user.isAdmin ) {
      throw new Error(t('page.app-options.error.notAdmin'))
    }

    page.title = t('page.app-options.seo.title')
    page.description = t('page.app-options.seo.description')

    usePullClient()
    startPullClient()

    loadData()
  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: true,
      clearErrorHref: '/slider/app-options.html'
    })
  } finally {
    page.isLoading = false
  }
})

onUnmounted(() => {
  destroyB24Helper()
})
// endregion ////
</script>

<template>
  <NuxtLayout name="slider">
    <B24Accordion
      v-model="activeInfoItem"
      type="multiple"
      :items="infoItems"
      :b24ui="{
          root: 'light',
          item: 'mb-[16px] last:mb-0 bg-(--ui-color-bg-content-primary) rounded-(--ui-border-radius-md) border-b-0',
          trigger: 'py-[20px] px-[20px]',
          label: 'text-(length:--ui-font-size-2xl) text-(--ui-color-text-primary)',
          leadingIcon: 'text-(--ui-color-base-60)',
          trailingIcon: 'text-(--ui-color-text-primary)',
        }"
    >
      <template #target>
        <div class="px-4 pb-[12px]">
          <B24Separator class="mb-3" />
          <div class="flex flex-col items-start justify-between gap-[18px]">
            <B24Alert
              color="air-secondary"
              :description="$t('page.app-options.option.target.alert')"
              :b24ui="{ description: 'text-(--ui-color-base-70)' }"
            />
          </div>
        </div>
      </template>
    </B24Accordion>

    <ProsePre>{{ ufSmartLink }}</ProsePre>

    <B24Advice
      class="w-full max-w-[550px]"
      :b24ui="{ descriptionWrapper: 'w-full' }"
      :avatar="{ src: '../avatar/assistant.png' }"
    >
      <ProseH3>@todo</ProseH3>
      <ProseP>Конфиг руками указываем в <ProseCode>app/stores/appSettings.ts</ProseCode></ProseP>
    </B24Advice>

    <template #footer>
      <div class="light bg-(--popup-window-background-color) flex items-center justify-center gap-3 border-t-1 border-t-(--ui-color-divider-less) shadow-top-md py-[9px] px-2 pr-(--scrollbar-width)">
        <div class="flex flex-row gap-[10px]">
          <B24Button
            :label="t('page.app-options.actions.save')"
            color="air-primary-success"
            loading-auto
            @click.stop="makeSave"
          />
          <B24Button
            :label="t('page.app-options.actions.cancel')"
            color="air-tertiary"
            @click.stop="makeCancel"
          />
        </div>
      </div>
    </template>
  </NuxtLayout>
</template>
