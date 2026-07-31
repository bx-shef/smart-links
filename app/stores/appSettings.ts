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
     * simply show «Поле ещё не настроено» in every card, with nothing anywhere saying why.
     *
     * What this does NOT close: get→set is still a read-modify-write, so two saves of different
     * fields overlapping within one REST round-trip (~a second; longer under the SDK's throttling)
     * can still lose one. The window shrank from "since the slider opened" to that round-trip —
     * client-side, with no compare-and-set in the API, that is the floor.
     */
    const saveSettings = async (ufCode: string, config: UfSmartLinkType) => {
      if ($b24 === null) {
        throw new Error('B24 non init. Use appSettings.setB24()')
      }

      const fresh = await $b24.callMethod('app.option.get', {})
      if (!fresh.isSuccess) {
        // A resolved-but-errored answer must abort the save, not be read as "the portal has no
        // options yet": treating it as empty would publish a single-key map that deletes every
        // other field's config — the exact loss this function exists to prevent.
        // Worded to not start with "app." — the locale guard treats a backtick string opening
        // with a namespace prefix as a built key, and it cannot tell an error message apart.
        throw new Error(`reading app options failed: ${fresh.getErrorMessages().join('; ')}`)
      }
      // The REST answer is the flat option map itself (verified against the SDK's own
      // OptionsManager and the app.option.get docs) — there is no `.options` wrapper. Do not
      // "defensively" reach for one: an option literally named `options` would then shadow the
      // map and funnel the merge into {}.
      const rawOptions = fresh.getData().result ?? {}
      const snapshot = () => JSON.parse(JSON.stringify(configUfListSettings)) as Record<string, unknown>
      let current: Record<string, unknown>
      try {
        const parsed = JSON.parse(String(rawOptions.configUfListSettings ?? '{}'))
        // Parseable-but-not-a-map ("[]", "null", "0") means the same thing as unparseable — the
        // stored value is corrupt — and must degrade the same way: to our snapshot, not to {}.
        current = Type.isPlainObject(parsed) ? parsed : snapshot()
      } catch {
        current = snapshot()
      }

      current[ufCode] = config

      await $b24.callMethod(
        'app.option.set',
        {
          options: {
            configUfListSettings: JSON.stringify(current)
          }
        }
      )
      // Only after the portal accepted the write: updating the local map first meant a FAILED save
      // still showed the edits as saved when the slider was reopened in the same frame.
      Object.assign(configUfListSettings, current)
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
