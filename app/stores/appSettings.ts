import type { B24Frame, TypeEnumAppStatus } from '@bitrix24/b24jssdk'
import type { UfSmartLinkType } from '#shared/types/base'
import { EnumCrmEntityTypeId, Type } from '@bitrix24/b24jssdk'

/**
 * Some info about App
 */
export const useAppSettingsStore = defineStore(
  'appSettings',
  () => {
    let $b24: null | B24Frame = null

    // region State ////

    type UfListConfigType = { [key: string]: UfSmartLinkType }

    const version = ref(0)
    const status = ref<TypeEnumAppStatus>('Free')
    const isTrial = ref(true)
    /**
     * Map of ufCode -> config. Populated from portal app options via initFromBatch();
     * edited through the settings slider (slider/app-options). No portal-specific defaults.
     */
    const configUfListSettings = reactive<UfListConfigType>({})
    // endregion ////

    // region Actions ////
    /**
     * @memo #entityId#
     */
    const getTargetPath = (entityTypeId: number, entityMode: string) => {
      if (entityMode === 'crm') {
        switch (entityTypeId) {
          case EnumCrmEntityTypeId.deal: return `/crm/deal/details/#entityId#/`
        }
      } else if(entityMode === 'lists') {
        return `/services/lists/${entityTypeId}/element/0/#entityId#/`
      }

      return ''
    }

    const getNewTargetPath = (entityTypeId: number, entityMode: string) => {
      if (entityMode === 'crm') {
        switch (entityTypeId) {
          case EnumCrmEntityTypeId.deal: return `/crm/deal/details/0/`
        }
      } else if(entityMode === 'lists') {
        return `/services/lists/${entityTypeId}/element/0/0/`
      }

      return ''
    }

    function setB24(b24: B24Frame) {
      $b24 = b24
    }

    /**
     * Initialize store from batch response data
     * @param data - Raw data from Bitrix24 API
     * @param data.version
     * @param data.status
     * @param data.configUfListSettings
     */
    function initFromBatch(data: {
      version?: number
      status?: TypeEnumAppStatus
      configUfListSettings?: Record<string, any>
    }) {
      if (data.status) {
        status.value = data.status
        isTrial.value = status.value === 'Trial'
      }

      if (data.version) {
        version.value = data.version
      }

      if (data.configUfListSettings && Type.isPlainObject(data.configUfListSettings)) {
        Object.assign(configUfListSettings, data.configUfListSettings)
      }
    }

    /**
     * Save ONE field's config to Bitrix24, merging over the portal's current state.
     *
     * App options are stored as strings, so the config map is JSON-encoded and sent under the
     * documented `{ options }` signature (mirrors @bitrix24/b24jssdk OptionsManager, which reads
     * it back via getJsonObject).
     *
     * The re-read before the write is the point of this function. `app.option.set` has no
     * compare-and-set, and this store's map was loaded when the settings slider OPENED — writing
     * the whole map back would publish that stale snapshot, silently reverting any field another
     * administrator (or the same one in a second tab) saved in the meantime. Their field would
     * simply show «Поле ещё не настроено» in every card, with nothing anywhere saying why. So the
     * save fetches the portal's current map, replaces only the key being edited, and writes that.
     * Two admins editing the SAME field still last-write-wins — that race is honest; losing a
     * field you never touched is not.
     */
    const saveSettings = async (ufCode: string, config: UfSmartLinkType) => {
      if ($b24 === null) {
        console.error('B24 non init. Use appSettings.setB24()')
        return
      }

      const fresh = await $b24.callMethod('app.option.get', {})
      const rawOptions = fresh.getData().result?.options ?? fresh.getData().result ?? {}
      let current: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(String(rawOptions.configUfListSettings ?? '{}'))
        if (Type.isPlainObject(parsed)) {
          current = parsed
        }
      } catch {
        // Unparseable stored options: fall back to our snapshot rather than erasing everything.
        current = JSON.parse(JSON.stringify(configUfListSettings))
      }

      current[ufCode] = config
      // Keep the local snapshot in step with what was just published, other admins' keys included.
      Object.assign(configUfListSettings, current)

      return $b24.callMethod(
        'app.option.set',
        {
          options: {
            configUfListSettings: JSON.stringify(current)
          }
        }
      )
    }
    // endregion ////

    return {
      version,
      isTrial,
      setB24,
      initFromBatch,
      saveSettings,
      configUfListSettings,
      getTargetPath,
      getNewTargetPath
    }
  }
)
