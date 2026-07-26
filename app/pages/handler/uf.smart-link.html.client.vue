<script setup lang="ts">
import type { B24Frame, TypePullMessage } from '@bitrix24/b24jssdk'
import type { UfSmartLinkType } from '#shared/types/base'
import { EnumCrmEntityTypeId, Type  } from '@bitrix24/b24jssdk'
import { ref, onMounted, onUnmounted } from 'vue'
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
const { $initializeB24Frame } = useNuxtApp()
let $b24: null | B24Frame = null
const isSetUfSettings = ref(true)
const isEditMode = ref(false)

/**
 * Это код текущего поля
 */
const ufCode = ref('')
const currentEntityTypeId = ref(EnumCrmEntityTypeId.undefined)
const currentEntityId = ref(0)
const configUfSetting = ref<undefined | UfSmartLinkType>(undefined)
/**
 * Это код поля в которое пишем id
 */
const ufDestinationCode = ref('')
/**
 * Это сптсок из которого мы что-то выберем
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
    // вообще не загрузило
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
        // в источнике есть, а по факту нет (или прав нет)
        link.initFromBatch({
          entityMode: configUfSetting.value.target.entityMode,
          entityTypeId: configUfSetting.value.target.entityTypeId,
          id: Number.parseInt(originEntity[ufDestinationCode.value]),
          title: '????'
        })
        await preLoadData(isFixLoadPage)
      } else {
        // все-таки загрузили ссылку
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
        // в источнике есть, а по факту нет (или прав нет)
        link.initFromBatch({
          entityMode: configUfSetting.value.target.entityMode,
          entityTypeId: configUfSetting.value.target.entityTypeId,
          id: Number.parseInt(originEntity[ufDestinationCode.value]),
          title: '????'
        })
        await preLoadData(isFixLoadPage)
      } else {
        // все-таки загрузили ссылку
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
 * Делает предзагрузку списка элементов для подбора
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

      // Сейчас выберем с учтом ID - тк OR нет поддержки
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

      // Сейчас выберем с учтом заголовка
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

  } catch (error) {
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: true,
      clearErrorHref: '/handler/uf.smart-link.html'
    })
  } finally {
    if (isFixLoadPage) {
      await sleepAction(1000)
      page.isLoading = false
    }
  }
}
// endregion ////

// region Actions ////
async function makeOpenLink() {
  if (!$b24) {
    return
  }

  const url = appSettings.getTargetPath(link.entityTypeId, link.entityMode).replace('#entityId#', link.id.toString())
  const path = $b24.slider.getUrl(url)
  if (link.entityMode === 'lists') {
    window.open(path, '_blank')
    return
  }
  await $b24?.slider.openPath(
    path,
    950
  )
}

/**
 * Новое создаем
 */
async function addNewEntity() {
  if (!$b24) {
    return
  }

  const url = appSettings.getNewTargetPath(link.entityTypeId, link.entityMode).replace('#entityId#', '0')
  const path = $b24.slider.getUrl(url)
  /**
   * @todo ут нужно подмены и заполнение параметров написать адекватное
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

    const myWindow = window.open(`${path.toString()}?${query}` , '_blank')
    const timer = setInterval(async () => {
      if (myWindow && myWindow.closed) {
        clearInterval(timer)

        await loadData()
      }
    }, 500)

    return
  }

  await $b24?.slider.openPath(
    path,
    950
  )
}

async function makeOpenLinkById(entity: EntityItem) {
  if (!$b24) {
    return
  }

  const url = appSettings.getTargetPath(link.entityTypeId, link.entityMode).replace('#entityId#', entity.id.toString())
  const path = $b24.slider.getUrl(url)

  if (link.entityMode === 'lists') {
    window.open(path, '_blank')
    return
  }
  await $b24?.slider.openPath(
    path,
    950
  )
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
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: true,
      clearErrorHref: '/handler/uf.smart-link.html'
    })
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
    processErrorGlobal(error, {
      homePageIsHide: true,
      isShowClearError: true,
      clearErrorHref: '/handler/uf.smart-link.html'
    })
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
async function resizeWindow() {
  await $b24?.parent.resizeWindow(
    340,
    isEditMode.value
      ? 260
      : link.isEmpty
        ? 270
        : 85
  )
}
// endregion ////

// region Lifecycle Hooks ////
onMounted(async () => {
  try {
    page.isLoading = true

    $b24 = await $initializeB24Frame()
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
      clearErrorHref: '/handler/uf.smart-link.html'
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
        :avatar="{ src: '../avatar/assistant.png' }"
      >
        <ProseH4>{{ $t('uf.smart-link.error.edit-mode.title') }}</ProseH4>
        <ProseP small>{{ $t('uf.smart-link.error.edit-mode.line1') }}</ProseP>
        <ProseP small>{{ $t('uf.smart-link.error.edit-mode.line2') }}</ProseP>
      </B24Advice>
    </div>
    <div v-if="!isSetUfSettings" class="flex flex-col items-center justify-center h-screen">
      <B24Advice
        angle="top"
        class="mt-[4px] w-full max-w-[550px]"
        :b24ui="{ descriptionWrapper: 'w-full' }"
        :avatar="{ src: '../avatar/assistant.png' }"
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
        <div v-if="link.isEmpty" class="h-[245px]">
          <div v-if="page.isLoading">
            <ProseP>грузим...</ProseP>
          </div>
          <template v-else>
            <B24TableWrapper
              size="xs"
              class="overflow-x-auto w-full h-[235px] bg-white"
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
                        @click.stop="addNewEntity"
                      />
                      <B24Input
                        v-model="filterTitle"
                        placeholder="Что-то из названия или Id"
                        @keyup.enter="preLoadData(true)"
                      />
                      <B24Button
                        loading-auto
                        label="Найти"
                        @click="preLoadData(true)"
                      />
                      <B24Button
                        loading-auto
                        :icon="RefreshIcon"
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
                      color="air-secondary-alert"
                      description="Пусто. Ничего не нашли"
                    />
                  </td>
                </tr>
                <template
                  v-for="(entity) in listEntity"
                  :key="entity.id"
                >
                <tr>
                  <td><B24Link is-action @click="makeOpenLinkById(entity)">{{ entity.id }}</B24Link></td>
                  <td><div class="cursor-pointer" @click="makeAddLink(entity)">{{ entity.title }}</div></td>
                </tr>
                </template>
              </tbody>
              </table>
            </B24TableWrapper>
          </template>
        </div>
        <div v-else class="h-[65px] flex flex-row items-start justify-between gap-[8px]">
          <div class="flex flex-col gap-[4px]">
            <B24Link
              is-action
              class="text-[16px] w-[250px] truncate"
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
