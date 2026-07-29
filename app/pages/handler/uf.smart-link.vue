<script setup lang="ts">
import type { B24Frame, TypePullMessage } from '@bitrix24/b24jssdk'
import type { UfSmartLinkType } from '#shared/types/base'
import { EnumCrmEntityTypeId, Type  } from '@bitrix24/b24jssdk'
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { usePageStore } from '~/stores/page'
import { useLinkStore } from '~/stores/link'
import { useUserStore } from '~/stores/user'
import { useAppSettingsStore } from '~/stores/appSettings'
import { sleepAction } from '~/utils/sleep'
import { resolveIblockTypeId } from '~/utils/listsTarget'
import DeleteHyperlinkIcon from '@bitrix24/b24icons-vue/main/DeleteHyperlinkIcon'
import DocumentPlusIcon from '@bitrix24/b24icons-vue/main/DocumentPlusIcon'
import RefreshIcon from '@bitrix24/b24icons-vue/outline/RefreshIcon'

definePageMeta({
  layout: 'uf-placement'
})

/** Floor for the placement height, so an empty state does not collapse to nothing. */
const MIN_PLACEMENT_HEIGHT = 85

interface EntityItem {
  id: number
  title: string
}

const { t, locales: localesI18n, setLocale } = useI18n()
const page = usePageStore()

// region Init ////
const { $logger, moduleId, initApp, reloadData, b24Helper, destroyB24Helper, usePullClient, useSubscribePullClient, startPullClient, processErrorGlobal } = useAppInit('uf-placement')
const link = useLinkStore()
const appSettings = useAppSettingsStore()
const user = useUserStore()
const { init: initB24Frame } = useB24()
let $b24: null | B24Frame = null
const isSetUfSettings = ref(true)
const isEditMode = ref(false)
/**
 * Message for a failed action (search / link / unlink), shown inside the placement.
 *
 * These are recoverable: the card is fine, the field is configured, one REST call did not go
 * through. Routing them to `processErrorGlobal` replaced the whole placement — a 65 px window
 * inside someone's CRM card — with the full-screen error page, so a hiccup in the search looked
 * like the app had died and took the linked record's controls away with it. Only a failure that
 * leaves nothing to show (no frame, no settings) belongs on the error page.
 */
const actionError = ref('')

/** Log the real error for support and show the user what to do about it. */
function reportActionError(error: unknown, messageKey: string) {
  $logger.error(error)
  actionError.value = t(messageKey)
}

/**
 * UF field code of the current placement
 */
const ufCode = ref('')
const currentEntityTypeId = ref(EnumCrmEntityTypeId.undefined)
const currentEntityId = ref(0)
const configUfSetting = ref<undefined | UfSmartLinkType>(undefined)
/**
 * Code of the destination field we write the linked id into
 */
const ufDestinationCode = ref('')
/**
 * Candidate list to pick a target from
 */
const listEntity = ref<EntityItem[]>([])

const filterTitle = ref('')
const filterFromOrigin = ref<Record<string, undefined | number>>({
  companyId: undefined,
  contactId: undefined,
  myCompanyId: undefined,
  dogovorId: undefined
})
// endregion ////

// region Init Data ////
/**
 * Refresh the placement from the portal, reporting its own failures.
 *
 * The guard is the point. This runs at the end of every write, and it issues REST calls of its
 * own — so without a catch here a failed refresh surfaced as the WRITE's error message: the field
 * had in fact been changed, while the alert said the card was untouched and told the user to press
 * a control that the already-updated view no longer rendered.
 */
async function loadData(isFixLoadPage: boolean = true): Promise<void> {
  try {
    await loadDataFromPortal(isFixLoadPage)
  } catch (error) {
    reportActionError(error, 'uf.smart-link.error.load')
  }
}

/**
 * Refresh after a successful write, keeping the spinner up for the whole round trip.
 *
 * The spinner has to be managed here rather than left to the write's own `finally`: the refresh
 * now runs outside it, and `loadData` only raises the spinner on the branches that reach
 * `preLoadData`, so the branch where the link resolves would otherwise refresh with no indication
 * that anything is happening.
 */
async function refreshAfterWrite(): Promise<void> {
  page.isLoading = true
  try {
    await loadData()
  } finally {
    page.isLoading = false
  }
}

async function loadDataFromPortal(
  isFixLoadPage: boolean = true
) {
  if (!$b24) {
    return
  }

  // $logger.info('Hi from uf-placement', $b24.placement.options)
  // $logger.log('appSettings', appSettings.configUfListSettings)

  configUfSetting.value = appSettings.configUfListSettings[ufCode.value]
  if (
    Type.isUndefined(configUfSetting.value)
    || !Type.isPlainObject(configUfSetting.value)
  ) {
    $logger.error('No Settings', ufCode.value)
    isSetUfSettings.value = false
    return
  }

  isSetUfSettings.value = true
  ufDestinationCode.value = configUfSetting.value.ufDestination

  const responseOriginEntity = await $b24.callMethod(
    'crm.item.list',
    {
      entityTypeId: currentEntityTypeId.value,
      select: [
        'id',
        'title',
        ufDestinationCode.value,
        configUfSetting.value.orign.clientFields.companyId,
        configUfSetting.value.orign.clientFields.contactId,
        configUfSetting.value.orign.clientFields.myCompanyId,
        configUfSetting.value.orign.clientFields.dogovorId,
      ].filter(Boolean),
      filter: {
        id: currentEntityId.value
      }
    }
  )
  const originEntity = responseOriginEntity.getData().result.items[0] || {}

  if (configUfSetting.value.orign.clientFields.companyId) {
    filterFromOrigin.value.companyId = configUfSetting.value.orign.isFilterBy.company ? Number.parseInt(originEntity[configUfSetting.value.orign.clientFields.companyId]) : undefined
  }
  if (configUfSetting.value.orign.clientFields.contactId) {
    filterFromOrigin.value.contactId = configUfSetting.value.orign.isFilterBy.contact ? Number.parseInt(originEntity[configUfSetting.value.orign.clientFields.contactId]) : undefined
  }
  // @todo add myCompany
  // @todo add dogovor

  if (
    !Type.isNumber(Number.parseInt(originEntity.id))
    || !Type.isNumber(Number.parseInt(originEntity[ufDestinationCode.value]))
    || originEntity.id < 1
    || originEntity[ufDestinationCode.value] < 1
  ) {
    // nothing loaded at all
    link.makeEmpty(
      configUfSetting.value.target.entityTypeId,
      configUfSetting.value.target.entityMode
  )
    await preLoadData(isFixLoadPage)
  } else {
    if (configUfSetting.value.target.entityMode === 'crm') {
      const responseTargetEntity = await $b24.callMethod(
        'crm.item.list',
        {
          entityTypeId: configUfSetting.value.target.entityTypeId,
          select: [
            'id',
            'title'
          ],
          filter: {
            id: Number.parseInt(originEntity[ufDestinationCode.value])
          }
        }
      )
      const targetEntity = responseTargetEntity.getData().result.items[0] || {}

      if (
        !Type.isNumber(targetEntity.id)
        || targetEntity.id < 1
      ) {
        // present in the source, but missing in fact (or no access rights)
        link.initFromBatch({
          entityMode: configUfSetting.value.target.entityMode,
          entityTypeId: configUfSetting.value.target.entityTypeId,
          id: Number.parseInt(originEntity[ufDestinationCode.value]),
          title: t('uf.smart-link.list.unavailable')
        })
        await preLoadData(isFixLoadPage)
      } else {
        // link resolved successfully
        link.initFromBatch({
          entityMode: configUfSetting.value.target.entityMode,
          entityTypeId: configUfSetting.value.target.entityTypeId,
          id: Number.parseInt(targetEntity.id),
          title: (targetEntity.title || '').trim()
        })
      }
    } else if (configUfSetting.value.target.entityMode === 'lists') {
      const responseTargetEntity = await $b24.callMethod(
        'lists.element.get',
        {
          IBLOCK_TYPE_ID: resolveIblockTypeId(configUfSetting.value.target),
          IBLOCK_ID: configUfSetting.value.target.entityTypeId,
          SELECT: [
            'ID',
            'NAME'
          ],
          FILTER: {
            'ID': Number.parseInt(originEntity[ufDestinationCode.value])
          }
        }
      )
      const someData = responseTargetEntity.getData().result[0] || {}

      const targetEntity = {
        id: Number.parseInt(someData.ID),
        title: someData.NAME
      }

      if (
        !Type.isNumber(targetEntity.id)
        || targetEntity.id < 1
      ) {
        // present in the source, but missing in fact (or no access rights)
        link.initFromBatch({
          entityMode: configUfSetting.value.target.entityMode,
          entityTypeId: configUfSetting.value.target.entityTypeId,
          id: Number.parseInt(originEntity[ufDestinationCode.value]),
          title: t('uf.smart-link.list.unavailable')
        })
        await preLoadData(isFixLoadPage)
      } else {
        // link resolved successfully
        link.initFromBatch({
          entityMode: configUfSetting.value.target.entityMode,
          entityTypeId: configUfSetting.value.target.entityTypeId,
          id: targetEntity.id,
          title: (targetEntity.title || '').trim()
        })
      }
    }
  }

  // Resizing is the watcher's job. Doing it here measured the loading spinner, because every
  // caller that passes `isFixLoadPage` is holding `page.isLoading` true across this call.
}

/**
 * Pre-loads the list of candidate items for picking
 */
async function preLoadData( isFixLoadPage: boolean = true ) {
  if (!configUfSetting.value) {
    return
  }
  if (!$b24) {
    return
  }
  actionError.value = ''
  if (isFixLoadPage) {
    page.isLoading = true
  }

  try
  {
    if (configUfSetting.value.target.entityMode === 'crm') {
      const filter = Object.assign(
        {},
        configUfSetting.value.target.customFilter ?? {}
      )

      if (configUfSetting.value.orign.isFilterBy.company) {
        filter[configUfSetting.value.target.clientFields.companyId] = filterFromOrigin.value.companyId
      }
      if (configUfSetting.value.orign.isFilterBy.contact) {
        filter[configUfSetting.value.target.clientFields.contactId] = filterFromOrigin.value.contactId
      }

      if (filterTitle.value.length > 0) {
        filter[0] = {
          'logic': 'OR',
          '0': {
            '=id': filterTitle.value
          },
          '1': {
            '%=title': `%${filterTitle.value}%`
          }
        }
      }


      const params = {
        entityTypeId: link.entityTypeId,
        select: [
          'id',
          'title'
        ],
        filter: filter,
        order: {
          id: 'desc'
        }
      }

      const response = await $b24.callMethod(
        'crm.item.list',
        params
      )

      listEntity.value = (response.getData().result.items || []) as EntityItem[]
    } else if (configUfSetting.value.target.entityMode === 'lists') {
      const filter = Object.assign(
        {},
        configUfSetting.value.target.customFilter ?? {},
      )

      if (configUfSetting.value.orign.isFilterBy.company) {
        filter[configUfSetting.value.target.clientFields.companyId] = `CO_${filterFromOrigin.value.companyId}`
      }
      if (configUfSetting.value.orign.isFilterBy.contact) {
        filter[configUfSetting.value.target.clientFields.contactId] = `C_${filterFromOrigin.value.contactId}`
      }

      const listResult: EntityItem[] = []

      // First pass: filter by ID (Lists has no OR support)
      if (filterTitle.value.length > 0) {
        filter['ID'] = filterTitle.value
      }

      const params = {
        IBLOCK_TYPE_ID: resolveIblockTypeId(configUfSetting.value.target),
        IBLOCK_ID: link.entityTypeId,
        SELECT: [
          'ID',
          'NAME'
        ],
        FILTER: filter,
        ELEMENT_ORDER: {
          SORT: 'desc',
          ID: 'desc',
        }
      }

      const response = await $b24.callMethod(
        'lists.element.get',
        params
      )

      const someData = response.getData().result || []
      someData.forEach((row: any) => {
        listResult.push({
          id: row['ID'],
          title: row['NAME'],
        } as EntityItem)
      })

      // Second pass: filter by title
      if (filterTitle.value.length > 0) {
        filter['ID'] = undefined
        filter['%NAME'] = filterTitle.value

        const params = {
          IBLOCK_TYPE_ID: resolveIblockTypeId(configUfSetting.value.target),
          IBLOCK_ID: link.entityTypeId,
          SELECT: [
            'ID',
            'NAME'
          ],
          FILTER: filter,
          ELEMENT_ORDER: {
            SORT: 'desc',
            ID: 'desc',
          }
        }

        const response = await $b24.callMethod(
          'lists.element.get',
          params
        )

        const someData = response.getData().result || []
        someData.forEach((row: any) => {
          listResult.push({
            id: row['ID'],
            title: row['NAME'],
          } as EntityItem)
        })
      }

      listEntity.value = listResult
    }
  } catch (error) {
    reportActionError(error, 'uf.smart-link.error.load')
  } finally {
    if (isFixLoadPage) {
      await sleepAction(1000)
      page.isLoading = false
    }
  }
}
// endregion ////

// region Actions ////
/**
 * Open a portal path: the slider for CRM targets, a new tab for Lists targets.
 *
 * The split looks arbitrary and is not. Routing Lists through the slider was tried and reverted
 * after reading the SDK: `slider.openPath` prefixes the path with `/crm/company/requisite/0/../../../..`
 * before sending it, so a Lists URL passes the portal's prefix check by traversal rather than by
 * being supported — the refusal a "try the slider, fall back on error" scheme depends on would
 * likely never arrive. Two further reasons a fallback cannot carry that weight: `openPath` settles
 * from the parent frame's reply, so a `window.open` in its catch runs with no user activation and
 * the browser blocks it; and `openPath` arms no timeout, so an unanswered command hangs the caller
 * forever where the old `window.closed` poll could not.
 *
 * Whether the portal slider actually renders a Lists element page needs a live check on a portal
 * with a Lists target. Until then this keeps the behaviour that is known to work.
 */
function isListsTarget(): boolean {
  return link.entityMode === 'lists'
}

/**
 * Poll handle for the "create a Lists element" tab.
 *
 * Held at this level so it can be cleared on unmount: a CRM card can be closed while the tab is
 * still open, and an interval left running keeps a closure over the whole page alive and fires a
 * refresh into a placement that no longer exists.
 */
let newEntityTimer: ReturnType<typeof setInterval> | null = null

function clearNewEntityWatch() {
  if (newEntityTimer !== null) {
    clearInterval(newEntityTimer)
    newEntityTimer = null
  }
}

async function openInPortal(path: URL): Promise<void> {
  if (!$b24) {
    return
  }
  await $b24.slider.openPath(path, 950)
}

async function makeOpenLink() {
  if (!$b24) {
    return
  }

  const url = appSettings.getTargetPath(link.entityTypeId, link.entityMode).replace('#entityId#', link.id.toString())
  const path = $b24.slider.getUrl(url)

  if (isListsTarget()) {
    // Synchronous, inside the click handler: this is the only place the browser still counts the
    // user gesture, and a `window.open` deferred behind an await is blocked as a popup.
    window.open(path, '_blank')
    return
  }
  await openInPortal(path)
}

/**
 * Create a new target entity
 */
async function addNewEntity() {
  if (!$b24) {
    return
  }

  const url = appSettings.getNewTargetPath(link.entityTypeId, link.entityMode).replace('#entityId#', '0')
  const path = $b24.slider.getUrl(url)
  /**
   * @todo write proper param substitution / prefill here
   */
  // ?=&fieldId=&=&shSmartLink_ENTITY_ID=&shSmartLink_ENTITY_TYPE_ID=2

  let defaultValue = ''
  let fieldId = ''
  if (configUfSetting.value!.orign.isFilterBy.company) {
    fieldId = configUfSetting.value!.target.clientFields.companyId
    defaultValue = `CO_${filterFromOrigin.value.companyId}`
  }
  if (configUfSetting.value!.orign.isFilterBy.contact) {
    fieldId = configUfSetting.value!.target.clientFields.contactId
    defaultValue = `C_${filterFromOrigin.value.contactId}`
  }

  if (link.entityMode === 'lists') {
    const query = new URLSearchParams({
      external_context: 'creatingElementFromCrm',
      fieldId,
      defaultValue,
      shSmartLink_ENTITY_ID: `${currentEntityId.value}`,
      shSmartLink_ENTITY_TYPE_ID: `${currentEntityTypeId.value}`,
    }).toString()

    // Opened synchronously (see openInPortal): a Lists page is not something the slider is known
    // to render, and deferring the open past an await loses the user gesture.
    const created = window.open(`${path.toString()}?${query}`, '_blank')
    // Poll for the tab closing so the list picks up whatever was just created. `created` is null
    // when the browser blocked the popup — refresh once instead of polling a window that does not
    // exist, otherwise the interval never clears.
    if (!created) {
      await refreshAfterWrite()
      return
    }
    clearNewEntityWatch()
    newEntityTimer = setInterval(async () => {
      if (created.closed) {
        clearNewEntityWatch()
        await refreshAfterWrite()
      }
    }, 500)
    return
  }

  await openInPortal(path)
  // openPath resolves when the slider closes, so the new record is already there to be found.
  await refreshAfterWrite()
}

async function makeOpenLinkById(entity: EntityItem) {
  if (!$b24) {
    return
  }

  const url = appSettings.getTargetPath(link.entityTypeId, link.entityMode).replace('#entityId#', entity.id.toString())
  const path = $b24.slider.getUrl(url)

  if (isListsTarget()) {
    window.open(path, '_blank')
    return
  }
  await openInPortal(path)
}

async function makeAddLink(entity: EntityItem) {
  if (!configUfSetting.value) {
    return
  }

  if (!$b24) {
    return
  }

  if (
    Type.isUndefined(configUfSetting.value)
    || !Type.isPlainObject(configUfSetting.value)
  ) {
    $logger.error('No Settings', ufCode.value)
    isSetUfSettings.value = false
    return
  }

  actionError.value = ''
  let written = false

  // Only the write belongs in here. The refresh that follows it must not be able to report itself
  // as a failed link — by the time it runs the card HAS been updated, and the message for a failed
  // link says the opposite.
  try {
    page.isLoading = true

    const params: Record<string, any> = {
      entityTypeId: currentEntityTypeId.value,
      id: currentEntityId.value,
      fields: {}
    }
    params.fields[ufDestinationCode.value] = entity.id

    await $b24.callMethod(
      'crm.item.update',
      params
    )

    link.initFromBatch({
      entityMode: configUfSetting.value.target.entityMode,
      entityTypeId: configUfSetting.value.target.entityTypeId,
      id: entity.id,
      title: entity.title,
    })
    written = true
  } catch (error) {
    reportActionError(error, 'uf.smart-link.error.link')
  } finally {
    page.isLoading = false
  }

  if (written) {
    await refreshAfterWrite()
  }
}

async function makeUnLink() {
  if (!configUfSetting.value) {
    return
  }

  if (!$b24) {
    return
  }

  if (
    Type.isUndefined(configUfSetting.value)
    || !Type.isPlainObject(configUfSetting.value)
  ) {
    $logger.error('No Settings', ufCode.value)
    isSetUfSettings.value = false
    return
  }

  actionError.value = ''
  let written = false

  // Same split as makeAddLink: the refresh runs after the link is already gone, so it cannot be
  // allowed to claim the unlink failed.
  try {
    page.isLoading = true

    const params: Record<string, any> = {
      entityTypeId: currentEntityTypeId.value,
      id: currentEntityId.value,
      fields: {}
    }
    params.fields[ufDestinationCode.value] = ''

    await $b24.callMethod(
      'crm.item.update',
      params
    )

    link.makeEmpty(configUfSetting.value.target.entityTypeId, configUfSetting.value.target.entityMode)
    written = true
  } catch (error) {
    reportActionError(error, 'uf.smart-link.error.unlink')
  } finally {
    page.isLoading = false
  }

  if (written) {
    await refreshAfterWrite()
  }
}

function openSliderAppSettings() {
  $b24?.slider.openSliderAppPage({
    place: 'app-options',
    ufCode: ufCode.value,
    // The settings slider needs to know which entity this field lives on, otherwise it cannot
    // offer the entity's own fields to pick from and the admin is back to typing UF_CRM_ codes by
    // hand. Only the placement knows it — the slider has no other way to find out.
    sourceEntityTypeId: `${currentEntityTypeId.value}`,
    bx24_width: 650,
    bx24_title: t('page.app-options.seo.title'),
  })
}

const makeSendPullCommandHandler = async (message: TypePullMessage) => {
  if (message.command === 'reload.options') {
    $logger.warn("Get pull command for update. Reinit the application")
    actionError.value = ''
    // The try/finally is not optional here. The SDK invokes pull callbacks fire-and-forget, so a
    // rejection anywhere in this chain is an unhandled promise rejection: the line clearing the
    // spinner never runs, and the layout hides the whole placement behind it until the CRM card is
    // reloaded. An admin saving settings would spin every open card in the portal.
    page.isLoading = true
    try {
      await reloadData()
      await loadData()
    } catch (error) {
      reportActionError(error, 'uf.smart-link.error.load')
    } finally {
      page.isLoading = false
    }
  }
}
// endregion ////

// region Tools ////
// Re-measure whenever what is on screen changes size — the alert appearing, the view flipping
// between the candidate list and the linked row, the list filling in.
//
// The `page.isLoading` guard is the important part: the layout replaces the entire page body with
// a fixed-height spinner while loading, so a measurement taken then sizes the placement to the
// SPINNER. Every resize in this file used to run inside a loading window, which meant a card with
// a linked record (a 65 px row) permanently asked the portal for the spinner's ~270 px.
watch(
  () => [page.isLoading, actionError.value, link.isEmpty, listEntity.value.length] as const,
  async ([isLoading]) => {
    if (isLoading) {
      return
    }
    await resizeWindow()
  },
  { flush: 'post' }
)

async function resizeWindow() {
  // Size to the actual content rather than to hardcoded numbers. The height used to be a
  // three-way guess (260 / 270 / 85) that went wrong as soon as a record title wrapped.
  //
  // Swallow the failure deliberately. resizeWindowAuto measures the body and the SDK REJECTS a
  // resize whose measured width or height is zero — which is exactly what a placement laid out in
  // a hidden card tab measures. That rejection used to reach onMounted's catch and replace the
  // whole placement with the full-screen error page: a cosmetic call taking down the feature. A
  // placement at the portal's default size is a far better outcome than no placement.
  try {
    await $b24?.parent.resizeWindowAuto(undefined, MIN_PLACEMENT_HEIGHT)
  } catch (error) {
    $logger.warn('resizeWindowAuto refused the measured size', error)
  }
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

    link.setB24($b24)

    isEditMode.value = $b24.placement.options['MODE'] === 'edit'
    ufCode.value = $b24.placement.options['FIELD_NAME']
    currentEntityTypeId.value = Number.parseInt($b24.placement.options['ENTITY_DATA']['entityTypeId'])
    currentEntityId.value = Number.parseInt($b24.placement.options['ENTITY_DATA']['entityId'])

    // The white backdrop for edit mode is a class on the wrapper below, not a `useHead` call here.
    // unhead MERGES `bodyAttrs.class` as a set union rather than replacing it, so pushing a second
    // `light:[--air-theme-bg-color:…]` from the page left the body carrying both that value and the
    // layout's, at identical specificity (`:where()` contributes none) — which of the two won came
    // down to their byte order in the compiled stylesheet.
    usePullClient()
    useSubscribePullClient(
      makeSendPullCommandHandler.bind( this ),
      moduleId
    )
    startPullClient()
    await loadData(false)
    // No resize here: `page.isLoading` is still true until the finally below, so a measurement
    // taken now would size the placement to the loading spinner. The watcher above fires on the
    // transition to false, once the real content is on screen.
  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: true,
      clearErrorHref: '/handler/uf.smart-link'
    })
  } finally {
    page.isLoading = false
  }
})

onUnmounted(() => {
  clearNewEntityWatch()
  if (b24Helper.value) {
    destroyB24Helper()
  }
})
// endregion ////
</script>

<template>
  <div>
    <!--
      `py-4` rather than `h-screen` on these two advice states. `h-screen` is 100vh, which inside
      the placement iframe IS the height we are asking the portal for — so auto-measuring the body
      returned the height it already had, a fixed point the content could never grow out of. With
      the wrapper sized by its content the measurement means something, and an advice too tall for
      the current frame can actually ask for more room instead of being clipped.
    -->
    <div v-if="isEditMode" class="flex flex-col items-center justify-center py-4 bg-(--ui-color-base-white-fixed)">
      <B24Advice
        angle="top"
        class="mt-[4px] w-full max-w-[550px]"
        :b24ui="{ descriptionWrapper: 'w-full' }"
        :avatar="{ src: '/avatar/assistant.png' }"
      >
        <ProseH4>{{ $t('uf.smart-link.error.edit-mode.title') }}</ProseH4>
        <ProseP small>{{ $t('uf.smart-link.error.edit-mode.line1') }}</ProseP>
        <ProseP small>{{ $t('uf.smart-link.error.edit-mode.line2') }}</ProseP>
      </B24Advice>
    </div>
    <div v-else-if="!isSetUfSettings" class="flex flex-col items-center justify-center py-4">
      <B24Advice
        angle="top"
        class="mt-[4px] w-full max-w-[550px]"
        :b24ui="{ descriptionWrapper: 'w-full' }"
        :avatar="{ src: '/avatar/assistant.png' }"
      >
        <ProseH5>{{ $t('uf.smart-link.error.no-settings.title') }}</ProseH5>
        <ProseP small>{{ $t('uf.smart-link.error.no-settings.line1') }}</ProseP>
        <B24Button
          v-if="user.isAdmin"
          rounded
          :label="$t('uf.smart-link.error.no-settings.action')"
          color="air-primary"
          size="sm"
          @click.stop="openSliderAppSettings"
        />
      </B24Advice>
    </div>
    <template v-else>
      <div class="relative overflow-hidden">
        <B24Alert
          v-if="actionError"
          class="mb-[4px]"
          size="sm"
          color="air-primary-alert"
          :description="actionError"
        />
        <div v-if="link.isEmpty" class="h-[245px]">
          <B24TableWrapper
            size="xs"
            class="overflow-x-auto w-full h-[235px] bg-(--ui-color-base-white-fixed)"
            pin-rows
            :row-hover="listEntity.length > 0"
            bordered
            rounded
          >
            <table>
            <colgroup>
              <col style="min-width: 30px" >
              <col >
            </colgroup>
            <thead>
              <tr>
                <th colspan="3">
                  <B24ButtonGroup size="xs">
                    <B24Button
                      :icon="DocumentPlusIcon"
                      color="air-selection"
                      :aria-label="$t('uf.smart-link.list.createAria')"
                      @click.stop="addNewEntity"
                    />
                    <B24Input
                      v-model="filterTitle"
                      :placeholder="$t('uf.smart-link.list.searchPlaceholder')"
                      @keyup.enter="preLoadData(true)"
                    />
                    <B24Button
                      loading-auto
                      :label="$t('uf.smart-link.list.search')"
                      @click="preLoadData(true)"
                    />
                    <B24Button
                      loading-auto
                      :icon="RefreshIcon"
                      :aria-label="$t('uf.smart-link.list.refreshAria')"
                      @click="preLoadData(true)"
                    />
                  </B24ButtonGroup>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="listEntity.length < 1">
                <td colspan="2">
                  <B24Alert
                    class="mt-[4px]"
                    size="sm"
                    color="air-secondary"
                    :description="$t('uf.smart-link.list.empty')"
                  />
                </td>
              </tr>
              <template
                v-for="(entity) in listEntity"
                :key="entity.id"
              >
              <tr>
                <td><B24Link is-action @click="makeOpenLinkById(entity)">{{ entity.id }}</B24Link></td>
                <td><B24Link is-action @click="makeAddLink(entity)">{{ entity.title }}</B24Link></td>
              </tr>
              </template>
            </tbody>
            </table>
          </B24TableWrapper>
        </div>
        <div v-else class="h-[65px] flex flex-row items-start justify-between gap-[8px]">
          <div class="flex flex-col gap-[4px]">
            <B24Link
              is-action
              class="text-[16px] w-full min-w-0 truncate"
              @click="makeOpenLink"
            >
              {{ link.title }}
            </B24Link>
            <ProseP small accent="less-more">id: {{ link.id }}</ProseP>
          </div>
          <div class="">
            <B24Button
              color="air-tertiary-no-accent"
              :icon="DeleteHyperlinkIcon"
              loading-auto
              :aria-label="$t('uf.smart-link.list.unlinkAria')"
              @click="makeUnLink"
            />
          </div>
        </div>
        <div class="flex flex-row items-center justify-end gap-[4px]">
          <B24Button
            v-if="user.isAdmin"
            rounded
            :label="$t('uf.smart-link.error.no-settings.action')"
            color="air-tertiary-no-accent"
            size="xss"
            @click.stop="openSliderAppSettings"
          />
        </div>
      </div>
    </template>
  </div>
</template>
