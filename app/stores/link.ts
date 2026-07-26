import type { B24Frame } from '@bitrix24/b24jssdk'
import { EnumCrmEntityTypeId } from '@bitrix24/b24jssdk'

/**
 * Info forLink
 */
export const useLinkStore = defineStore(
  'link',
  () => {
    // Reserved for future use (mirrors appSettings store); intentionally unread for now.
    let _$b24: null | B24Frame = null

    // region State ////
    const id = ref(0)
    const title = ref('')
    const entityMode = ref('???')
    const entityTypeId = ref(EnumCrmEntityTypeId.undefined)
    // endregion ////

    // region Actions ////
    const isEmpty = computed(() => {
      return id.value < 1
    })

    /**
     * @memo #entityId#
     */
    const entityPath = computed(() => {
      switch (entityTypeId.value) {
        case EnumCrmEntityTypeId.deal: return `/crm/deal/details/${id.value}/`
      }

      return ''
    })

    function setB24(b24: B24Frame) {
      _$b24 = b24
    }

    /**
     * Initialize store from batch response data
     * @param data - Raw data from Bitrix24 API
     * @param data.entityTypeId
     * @param data.id
     * @param data.title
     */
    function initFromBatch(data: {
      entityMode: string,
      entityTypeId: number,
      id?: number
      title?: string
    }) {
      entityMode.value = data.entityMode
      entityTypeId.value = data.entityTypeId

      if (data.id) {
        id.value = data.id
      }

      if (data.title) {
        title.value = data.title
      }
    }

    /**
     * Reset to the "no link" state
     */
    function makeEmpty(paramEntityTypeId: number, paramEntityMode: string) {
      id.value = 0
      title.value = ''
      entityMode.value = paramEntityMode
      entityTypeId.value = paramEntityTypeId
    }
    // endregion ////

    return {
      id,
      title,
      entityMode,
      entityTypeId,
      entityPath,
      isEmpty,
      setB24,
      initFromBatch,
      makeEmpty
    }
  }
)
