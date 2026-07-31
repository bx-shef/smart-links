/**
 * Some info about User
 * @memo not save to settings
 */
export const useUserStore = defineStore(
  'user',
  () => {
    // region State ////
    const isAdmin = ref(false)
    // endregion ////

    // region Actions ////
    /**
     * Initialize store from batch response data.
     *
     * Only `isAdmin` is kept: a display name was also stored here for years and rendered nowhere —
     * the feedback form takes it straight from the SDK helper, so the copy was dead state.
     * @param data - Raw data from Bitrix24 API
     * @param data.isAdmin
     */
    function initFromBatch(data: {
      isAdmin?: boolean
    }) {
      isAdmin.value = data.isAdmin || false
    }
    // endregion ////

    return {
      isAdmin,
      initFromBatch
    }
  }
)
