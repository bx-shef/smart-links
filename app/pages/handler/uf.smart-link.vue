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
async function loadData(
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
          IBLOCK_TYPE_ID: configUfSetting.value.target.entityMode,
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

  if (isFixLoadPage) {
    await resizeWindow()
  }
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
        IBLOCK_TYPE_ID: configUfSetting.value.target.entityMode,
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
          IBLOCK_TYPE_ID: configUfSetting.value.target.entityMode,
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

    actionError.value = ''

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
 * Open a portal path.
 *
 * Always prefer the portal's own slider. This page lives in an iframe inside a CRM card, where
 * `window.open` is blocked by popup blockers, opens a bare tab in the Bitrix24 mobile client, and
 * breaks the "create the record, come back to the card" flow the placement is built around.
 * Lists paths used to bypass the slider on the assumption it could not handle them — so try it
 * first and fall back only if it actually refuses.
 *
 * Resolves when the slider closes, which is what lets the caller refresh afterwards without
 * polling `window.closed` (a poll that popup blockers and cross-origin rules break anyway).
 */
async function openInPortal(path: URL): Promise<void> {
  if (!$b24) {
    return
  }
  try {
    await $b24.slider.openPath(path, 950)
  } catch {
    window.open(path.toString(), '_blank')
  }
}

async function makeOpenLink() {
  if (!$b24) {
    return
  }

  const url = appSettings.getTargetPath(link.entityTypeId, link.entityMode).replace('#entityId#', link.id.toString())
  await openInPortal($b24.slider.getUrl(url))
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

    await openInPortal(new URL(`${path.toString()}?${query}`))
    await loadData()
    return
  }

  await openInPortal(path)
}

async function makeOpenLinkById(entity: EntityItem) {
  if (!$b24) {
    return
  }

  const url = appSettings.getTargetPath(link.entityTypeId, link.entityMode).replace('#entityId#', entity.id.toString())
  await openInPortal($b24.slider.getUrl(url))
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
    await loadData()
  } catch (error) {
    reportActionError(error, 'uf.smart-link.error.link')
  } finally {
    page.isLoading = false
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
    await loadData()
  } catch (error) {
    reportActionError(error, 'uf.smart-link.error.unlink')
  } finally {
    page.isLoading = false
  }
}

function openSliderAppSettings() {
  $b24?.slider.openSliderAppPage({
    place: 'app-options',
    ufCode: ufCode.value,
    bx24_width: 650,
    bx24_title: t('page.app-options.seo.title'),
  })
}

const makeSendPullCommandHandler = async (message: TypePullMessage) => {
  if (message.command === 'reload.options') {
    $logger.warn("Get pull command for update. Reinit the application")
    page.isLoading = true
    await reloadData()
    await loadData()
    page.isLoading = false
  }
}
// endregion ////

// region Tools ////
// The placement keeps whatever height the portal gave it, so an alert appearing below the content
// would be clipped out of sight — ask for a new measurement whenever it shows up or goes away.
watch(actionError, async () => {
  await nextTick()
  await resizeWindow()
})

async function resizeWindow() {
  // Size to the actual content rather than to hardcoded numbers. The fixed 340 px width came from
  // the donor template and stayed the same on a phone as on a wide monitor; the height was a
  // three-way guess that went wrong as soon as a record title wrapped.
  await $b24?.parent.resizeWindowAuto(undefined, MIN_PLACEMENT_HEIGHT)
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

    if (isEditMode.value) {
      useHead({
        bodyAttrs: {
          class: `light light:[--air-theme-bg-color:#ffffff]`
        }
      })
    }
    usePullClient()
    useSubscribePullClient(
      makeSendPullCommandHandler.bind( this ),
      moduleId
    )
    startPullClient()
    await loadData(false)
    await resizeWindow()
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
  if (b24Helper.value) {
    destroyB24Helper()
  }
})
// endregion ////
</script>

<template>
  <div>
    <div v-if="isEditMode" class="flex flex-col items-center justify-center h-screen">
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
    <div v-else-if="!isSetUfSettings" class="flex flex-col items-center justify-center h-screen">
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
