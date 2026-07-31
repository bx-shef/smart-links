<script setup lang="ts">
import type { B24Frame } from '@bitrix24/b24jssdk'
import type { UfSmartLinkType } from '#shared/types/base'
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { EnumCrmEntityTypeId, AjaxError, Type } from '@bitrix24/b24jssdk'
import { usePageStore } from '~/stores/page'
import { useUserStore } from '~/stores/user'
import { useAppSettingsStore } from '~/stores/appSettings'
import { DEFAULT_IBLOCK_TYPE_ID, ENUMERABLE_IBLOCK_TYPES, resolveIblockTypeId } from '~/utils/listsTarget'
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
const { init: initB24Frame } = useB24()
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
      iblockTypeId: DEFAULT_IBLOCK_TYPE_ID,
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

// region Pickers ////
// The two settings an admin used to have to type from memory: the destination field's UF code and,
// for a Lists target, the list's numeric id. Both exist in the portal and can simply be offered —
// typing them is how a setup ends up pointing at a field that does not exist, with nothing to say
// so until a user opens a card.
//
// Both pickers are fail-soft. If the portal refuses the lookup (rights, an unusual entity), the
// form falls back to the free-text input it always had rather than blocking the admin behind a
// list we could not fetch.
interface ListItem { label: string, value: number, section: string }

const sourceEntityTypeId = ref(0)
const ufFieldItems = ref<{ label: string, value: string }[]>([])
const ufFieldsUnavailable = ref(false)
const listItems = ref<ListItem[]>([])
const listsUnavailable = ref(false)
const manualListError = ref('')
/**
 * Manual list-number entry. Forced on when the portal enumerated nothing; toggleable otherwise —
 * group and project lists never appear in the enumeration, so the picker alone cannot reach them.
 */
const manualListEntry = ref(false)

function toggleManualListEntry() {
  manualListEntry.value = !manualListEntry.value
  manualListError.value = ''
}

async function loadUfFields() {
  ufFieldsUnavailable.value = false
  if (!$b24 || sourceEntityTypeId.value < 1) {
    ufFieldsUnavailable.value = true
    return
  }
  try {
    const response = await $b24.callMethod('crm.item.fields', { entityTypeId: sourceEntityTypeId.value })
    const fields = response.getData().result?.fields ?? {}
    ufFieldItems.value = Object.entries(fields)
      // User fields only: the destination has to be a field the admin created, never a system one.
      // Bitrix24 spells them `ufCrm…` in the camelCase item API and `UF_CRM_…` in the legacy one.
      .filter(([code]) => /^uf/i.test(code))
      .map(([code, meta]) => ({
        label: (meta as any)?.title ? `${(meta as any).title} — ${code}` : code,
        value: code
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'))
    ufFieldsUnavailable.value = ufFieldItems.value.length === 0
  } catch (error) {
    $logger.error(error)
    ufFieldsUnavailable.value = true
  }
}

/**
 * Offer every list this portal will enumerate, across sections.
 *
 * This replaces asking the admin which section their list lives in. That question was a bad one to
 * ask: Bitrix24's own menus do not use the section names the REST API does — universal lists sit
 * under Автоматизация → Списки while `bitrix_processes` sits under Лента → Ещё → Процессы — so any
 * label we wrote sent some admins to the wrong answer, and a wrong section is a hard REST error.
 * Picking the list itself makes the section a fact we read rather than a guess they make.
 *
 * `lists_socnet` is not enumerated: `lists.get` needs a workgroup id for it, which this screen does
 * not have. Those lists go through the manual path below, which resolves the section from the id.
 */
async function loadLists() {
  listsUnavailable.value = false
  listItems.value = []
  if (!$b24) {
    listsUnavailable.value = true
    return
  }
  const collected: ListItem[] = []
  for (const section of ENUMERABLE_IBLOCK_TYPES) {
    try {
      const response = await $b24.callMethod('lists.get', { IBLOCK_TYPE_ID: section })
      const rows = response.getData().result ?? []
      for (const row of (Array.isArray(rows) ? rows : [])) {
        collected.push({ label: `${row.NAME} — ${row.ID}`, value: Number.parseInt(row.ID), section })
      }
    } catch (error) {
      // One section refusing (rights) must not hide the other's lists.
      $logger.error(error)
    }
  }
  listItems.value = collected.sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  listsUnavailable.value = collected.length === 0
  if (listsUnavailable.value) {
    manualListEntry.value = true
  }
}

/** Record the section along with the list, so the placement queries where the list actually is. */
function onListPicked(listId: number) {
  const picked = listItems.value.find(item => item.value === listId)
  if (picked) {
    ufSmartLink.value.target.iblockTypeId = picked.section
  }
}

/**
 * Resolve the section for a list id typed by hand.
 *
 * `lists.get.iblock.type.id` answers exactly this question, so a list we could not enumerate (a
 * workgroup or project list, a custom information block) still does not need the admin to know
 * REST section codes. `null` means no list carries that id — worth saying, because the alternative
 * is a field that looks configured and finds nothing.
 */
async function resolveSectionForTypedId() {
  manualListError.value = ''
  const id = Number(ufSmartLink.value.target.entityTypeId)
  if (!$b24 || !(id > 0)) {
    return
  }
  try {
    const response = await $b24.callMethod('lists.get.iblock.type.id', { IBLOCK_ID: id })
    const section = response.getData().result
    if (typeof section === 'string' && section) {
      ufSmartLink.value.target.iblockTypeId = section
    } else {
      manualListError.value = t('page.app-options.form.listId.notFound')
    }
  } catch (error) {
    $logger.error(error)
    manualListError.value = t('page.app-options.form.listId.notFound')
  }
}

// Search and linking work in every section; opening a record in the portal is only proven for the
// universal-lists one, because the URL the app builds is that section's. Say so where the admin can
// act on it rather than letting them find out from a broken tab.
const listSectionWarning = computed(() => {
  if (ufSmartLink.value.target.entityMode !== 'lists') {
    return ''
  }
  const section = resolveIblockTypeId(ufSmartLink.value.target)
  return section === DEFAULT_IBLOCK_TYPE_ID ? '' : t('page.app-options.form.listId.openUnverified')
})
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

// Errors are only SHOWN once the admin has tried to save. Rendering them eagerly meant a freshly
// opened settings slider greeted the admin with a red «укажите код поля-приёмника» before they had
// typed anything — the empty state is not a mistake yet.
const submitted = ref(false)
const shownErrors = computed(() => (submitted.value
  ? errors.value
  : { ufDestination: undefined, entityTypeId: undefined, customFilter: undefined }))
// endregion ////

// region Actions ////
function loadData() {
  if (!$b24) {
    return
  }

  ufCode.value = $b24.placement.options['ufCode']
  // Passed by the placement that opened this slider; absent when the slider is reached any other
  // way, in which case the field picker degrades to the free-text input.
  sourceEntityTypeId.value = Number.parseInt($b24.placement.options['sourceEntityTypeId']) || 0
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

  // Normalise the section to the value the placement will actually use. An older config has no
  // `iblockTypeId` at all, and leaving it unset meant the screen showed nothing while the placement
  // quietly queried `lists` — the one screen built to fix a wrong-section field let you save
  // straight past it.
  ufSmartLink.value.target.iblockTypeId = resolveIblockTypeId(ufSmartLink.value.target)

  customFilterText.value = JSON.stringify(ufSmartLink.value.target.customFilter ?? {}, null, 2)
}

// Reset entityTypeId to a mode-appropriate default when the admin switches modes,
// so a leftover value (e.g. a Deal id) is not saved as a list iblock id.
// Registered after loadData() so it never fires for the initial (loaded) value.
function setupEntityModeWatch() {
  watch(
    () => ufSmartLink.value.target.entityMode,
    async (mode) => {
      ufSmartLink.value.target.entityTypeId = mode === 'crm' ? EnumCrmEntityTypeId.deal : 0
      // Reset the section along with the id. Leaving a previous section behind was the same class
      // of leftover this watcher already existed to prevent for entityTypeId, and it would show as
      // a stale "opening is unverified" warning against a list the admin has not chosen yet.
      ufSmartLink.value.target.iblockTypeId = DEFAULT_IBLOCK_TYPE_ID
      manualListError.value = ''
      if (mode === 'lists') {
        await loadLists()
      }
    }
  )
}

async function makeSave() {
  submitted.value = true
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

    // Commit the parsed customFilter (canSave already guarantees it is valid), then persist THIS
    // field's config. The store merges it over the portal's current options rather than writing
    // the whole map from our snapshot — see saveSettings for why that distinction is data-loss.
    const parsedFilter = parseJsonObject(customFilterText.value)
    ufSmartLink.value.target.customFilter = parsedFilter.ok ? parsedFilter.value : {}

    await appSettings.saveSettings(ufCode.value, JSON.parse(JSON.stringify(ufSmartLink.value)))

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

    $b24 = await initB24Frame()
    if (!$b24) {
      throw new FrameUnavailableError('Bitrix24 frame is not available (opened outside a portal)')
    }
    await initApp($b24, localesI18n, setLocale)

    if (!user.isAdmin) {
      throw new Error(t('page.app-options.error.notAdmin'))
    }

    page.title = t('page.app-options.seo.title')
    page.description = t('page.app-options.seo.description')

    usePullClient()
    startPullClient()

    loadData()
    // After loadData, so the lookups see the loaded config; awaited so the admin does not get a
    // free-text input that turns into a select under their cursor.
    await loadUfFields()
    if (ufSmartLink.value.target.entityMode === 'lists') {
      await loadLists()
    }
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
        :error="shownErrors.ufDestination"
        required
      >
        <B24Select
          v-if="!ufFieldsUnavailable"
          v-model="ufSmartLink.ufDestination"
          :items="ufFieldItems"
          value-key="value"
          label-key="label"
          class="w-full"
        />
        <B24Input
          v-else
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
        v-if="ufSmartLink.target.entityMode === 'crm'"
        :label="$t('page.app-options.form.crmType.label')"
        :error="shownErrors.entityTypeId"
        required
      >
        <B24Select
          v-model="ufSmartLink.target.entityTypeId"
          :items="crmTypeItems"
          value-key="value"
          label-key="label"
          class="w-full"
        />
      </B24FormField>

      <B24FormField
        v-else
        :label="$t('page.app-options.form.listId.label')"
        :help="$t('page.app-options.form.listId.help')"
        :error="shownErrors.entityTypeId || manualListError"
        required
      >
        <!--
          One control, every section. The admin picks the list by name; which portal section it
          lives in is read off the answer, not asked as a question — see loadLists() for why asking
          was the wrong design.
        -->
        <B24Select
          v-if="!manualListEntry"
          v-model="ufSmartLink.target.entityTypeId"
          :items="listItems"
          value-key="value"
          label-key="label"
          class="w-full"
          @update:model-value="onListPicked"
        />
        <!--
          Manual path for a list the portal would not enumerate (a group or project list, a custom
          information block). The number still does not require knowing section codes: the section
          is resolved from the id on blur. This used to render only when the enumeration came back
          EMPTY — which meant that on any portal with at least one ordinary list, a group list was
          simply unreachable: the select could not contain it and nothing let you type its number.
        -->
        <B24InputNumber
          v-else
          v-model="ufSmartLink.target.entityTypeId"
          class="w-full"
          @blur="resolveSectionForTypedId"
        />
        <B24Button
          v-if="!listsUnavailable"
          class="mt-[8px]"
          color="air-tertiary-no-accent"
          size="xss"
          :label="manualListEntry
            ? $t('page.app-options.form.listId.pickFromList')
            : $t('page.app-options.form.listId.enterManually')"
          @click="toggleManualListEntry"
        />
      </B24FormField>

      <B24Alert
        v-if="listSectionWarning"
        size="sm"
        color="air-primary-warning"
        :description="listSectionWarning"
      />

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
        :error="shownErrors.customFilter"
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
