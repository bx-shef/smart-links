<script setup lang="ts">
import type { B24Frame } from '@bitrix24/b24jssdk'
import type { UfSmartLinkType } from '#shared/types/base'
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { EnumCrmEntityTypeId, AjaxError, Type } from '@bitrix24/b24jssdk'
import { usePageStore } from '~/stores/page'
import { useUserStore } from '~/stores/user'
import { useAppSettingsStore } from '~/stores/appSettings'
import CloudErrorIcon from '@bitrix24/b24icons-vue/main/CloudErrorIcon'

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

/** Source client fields are the standard CRM item fields; fixed, not exposed in the form. */
function createEmptyConfig(): UfSmartLinkType {
  return {
    ufDestination: '',
    orign: {
      clientFields: { companyId: 'companyId', contactId: 'contactId', myCompanyId: undefined, dogovorId: undefined },
      isFilterBy: { company: false, contact: false, myCompany: false, dogovor: false }
    },
    target: {
      entityMode: 'crm',
      entityTypeId: EnumCrmEntityTypeId.deal,
      customFilter: {},
      clientFields: { companyId: 'companyId', contactId: 'contactId', myCompanyId: undefined, dogovorId: undefined }
    }
  }
}

// Editable copy; committed to the store only on save.
const ufSmartLink = ref<UfSmartLinkType>(createEmptyConfig())
// customFilter is edited as raw JSON text and parsed on save.
const customFilterText = ref('{}')

const entityModeItems = computed(() => [
  { label: t('page.app-options.form.entityMode.crm'), value: 'crm' },
  { label: t('page.app-options.form.entityMode.lists'), value: 'lists' }
])

// CRM targets are constrained to the entity types the path resolvers support
// (see appSettings.getTargetPath). Currently only Deal.
const crmTypeItems = computed(() => [
  { label: t('page.app-options.form.crmType.deal'), value: EnumCrmEntityTypeId.deal }
])
// endregion ////

// region Validation ////
const customFilterError = computed<string | undefined>(() => {
  const result = parseJsonObject(customFilterText.value)
  if (result.ok) {
    return undefined
  }
  return result.error === 'json'
    ? t('page.app-options.form.customFilter.errorJson')
    : t('page.app-options.form.customFilter.errorObj')
})

const errors = computed(() => ({
  ufDestination: Type.isStringFilled(ufSmartLink.value.ufDestination)
    ? undefined
    : t('page.app-options.form.ufDestination.error'),
  entityTypeId: Number(ufSmartLink.value.target.entityTypeId) > 0
    ? undefined
    : t('page.app-options.form.entityTypeId.error'),
  customFilter: customFilterError.value
}))

const canSave = computed(() => !errors.value.ufDestination && !errors.value.entityTypeId && !errors.value.customFilter)
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
    return
  }

  $logger.info('Hi from app-options', $b24?.placement)

  // A missing ufCode yields `undefined` (not `null`); use a fresh config in that case.
  // Clone an existing config so edits are only committed to the store on save.
  const existing = appSettings.configUfListSettings[ufCode.value]
  ufSmartLink.value = Type.isPlainObject(existing)
    ? JSON.parse(JSON.stringify(existing))
    : createEmptyConfig()

  customFilterText.value = JSON.stringify(ufSmartLink.value.target.customFilter ?? {}, null, 2)
}

// Reset entityTypeId to a mode-appropriate default when the admin switches modes,
// so a leftover value (e.g. a Deal id) is not saved as a list iblock id.
// Registered after loadData() so it never fires for the initial (loaded) value.
function setupEntityModeWatch() {
  watch(
    () => ufSmartLink.value.target.entityMode,
    (mode) => {
      ufSmartLink.value.target.entityTypeId = mode === 'crm' ? EnumCrmEntityTypeId.deal : 0
    }
  )
}

async function makeSave() {
  if (!canSave.value) {
    toast.add({
      title: t('page.app-options.error.title'),
      description: t('page.app-options.form.validation'),
      color: 'air-primary-alert',
      icon: CloudErrorIcon
    })
    return
  }

  try {
    page.isLoading = true

    // Commit the parsed customFilter (canSave already guarantees it is valid),
    // then persist the config into app options.
    const parsedFilter = parseJsonObject(customFilterText.value)
    ufSmartLink.value.target.customFilter = parsedFilter.ok ? parsedFilter.value : {}

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
      clearErrorHref: '/slider/app-options'
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

    if (!user.isAdmin) {
      throw new Error(t('page.app-options.error.notAdmin'))
    }

    page.title = t('page.app-options.seo.title')
    page.description = t('page.app-options.seo.description')

    usePullClient()
    startPullClient()

    loadData()
    setupEntityModeWatch()
  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: true,
      clearErrorHref: '/slider/app-options'
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
    <div class="light flex flex-col gap-[16px] px-4 pb-4">
      <B24Alert
        color="air-secondary"
        :description="$t('page.app-options.intro')"
        :b24ui="{ description: 'text-(--ui-color-base-70)' }"
      />

      <B24FormField
        :label="$t('page.app-options.form.ufDestination.label')"
        :help="$t('page.app-options.form.ufDestination.help')"
        :error="errors.ufDestination"
        required
      >
        <B24Input
          v-model="ufSmartLink.ufDestination"
          class="w-full"
          :placeholder="$t('page.app-options.form.ufDestination.placeholder')"
        />
      </B24FormField>

      <B24FormField :label="$t('page.app-options.form.entityMode.label')">
        <B24RadioGroup
          v-model="ufSmartLink.target.entityMode"
          :items="entityModeItems"
          value-key="value"
          label-key="label"
          orientation="horizontal"
        />
      </B24FormField>

      <B24FormField
        :label="$t('page.app-options.form.entityTypeId.label')"
        :help="$t('page.app-options.form.entityTypeId.help')"
        :error="errors.entityTypeId"
        required
      >
        <B24Select
          v-if="ufSmartLink.target.entityMode === 'crm'"
          v-model="ufSmartLink.target.entityTypeId"
          :items="crmTypeItems"
          value-key="value"
          label-key="label"
          class="w-full"
        />
        <B24InputNumber v-else v-model="ufSmartLink.target.entityTypeId" class="w-full" />
      </B24FormField>

      <B24FormField
        :label="$t('page.app-options.form.targetCompanyField.label')"
        :help="$t('page.app-options.form.targetCompanyField.help')"
      >
        <B24Input
          v-model="ufSmartLink.target.clientFields.companyId"
          class="w-full"
          placeholder="companyId / PROPERTY_XXX"
        />
      </B24FormField>

      <B24FormField :label="$t('page.app-options.form.targetContactField.label')">
        <B24Input
          v-model="ufSmartLink.target.clientFields.contactId"
          class="w-full"
          placeholder="contactId / PROPERTY_XXX"
        />
      </B24FormField>

      <div class="flex flex-col gap-[8px]">
        <B24Switch
          v-model="ufSmartLink.orign.isFilterBy.company"
          :label="$t('page.app-options.form.filterByCompany.label')"
        />
        <B24Switch
          v-model="ufSmartLink.orign.isFilterBy.contact"
          :label="$t('page.app-options.form.filterByContact.label')"
        />
      </div>

      <B24FormField
        :label="$t('page.app-options.form.customFilter.label')"
        :help="$t('page.app-options.form.customFilter.help')"
        :error="errors.customFilter"
      >
        <B24Textarea
          v-model="customFilterText"
          class="w-full"
          :rows="3"
          placeholder='{ "PROPERTY_XXX": false }'
        />
      </B24FormField>
    </div>

    <template #footer>
      <div class="light bg-(--popup-window-background-color) flex items-center justify-center gap-3 border-t-1 border-t-(--ui-color-divider-less) shadow-top-md py-[9px] px-2 pr-(--scrollbar-width)">
        <div class="flex flex-row gap-[10px]">
          <B24Button
            :label="t('page.app-options.actions.save')"
            color="air-primary-success"
            :disabled="!canSave"
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
