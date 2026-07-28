import { computed, type ComputedRef, ref } from "vue";
import { LoggerBrowser, AjaxError, LoadDataType, useB24Helper } from '@bitrix24/b24jssdk'
import type { B24Frame } from '@bitrix24/b24jssdk'
import type { Locale } from 'vue-i18n'
import type { LocaleObject } from '@nuxtjs/i18n'

export interface ProcessErrorData {
  description?: string
  isShowClearError?: boolean
  clearErrorHref?: string
  clearErrorTitle?: string
  homePageIsHide?: boolean
  homePageHref?: string
  homePageTitle?: string
}

const moduleId = 'main'

/**
 * Composable handling application initialization
 * Coordinates data loading via batch request
 */
export const useAppInit = (loggerTitle?: string) => {
  // Resolved per call (not at module scope): with SSR enabled, module-level state would become a
  // cross-request singleton on the server.
  const { initB24Helper, getB24Helper, destroyB24Helper: destroyB24HelperOry, usePullClient, useSubscribePullClient, startPullClient } = useB24Helper()
  const isInitB24Helper = ref(false)

  const $logger = LoggerBrowser.build(
    loggerTitle ?? 'App',
    import.meta.dev
  )

  const { t } = useI18n()

  // Stores
  const appSettings = useAppSettingsStore()
  const user = useUserStore()

  /**
   * Initialize application data
   * Performs batch request and updates all stores
   */
  async function initApp(
    $b24: B24Frame,
    localesI18n: ComputedRef<LocaleObject[]>,
    setLocale: (locale: Locale) => Promise<void>
  ) {
    $logger.info('InitApp start')
    await initLang($b24, localesI18n, setLocale)

    /**
     * @todo init data from helper
     */
    await initB24Helper(
      $b24,
      [
        LoadDataType.App,
        LoadDataType.AppOptions,
        LoadDataType.Profile
      ]
    )
    isInitB24Helper.value = true

    const data = {
      appInfo: getB24Helper().appInfo,
      appSettings: getB24Helper().appOptions,
      profileData: getB24Helper().profileInfo,
    }
    $logger.log('Init data >>', data)

    // Update stores with received data
    user.initFromBatch({
      name: data.profileData?.data.name ?? undefined,
      lastName: data.profileData?.data.lastName ?? undefined,
      isAdmin: data.profileData?.data.isAdmin
    })

    appSettings.setB24($b24)
    appSettings.initFromBatch({
      version: (data.appInfo?.data.version ?? 1),
      status: data.appInfo?.data.status,
      // App options are stored as JSON strings; getJsonObject parses them (default {}).
      configUfListSettings: data.appSettings?.getJsonObject('configUfListSettings')
    })

    $logger.info('InitApp stop')
  }

  async function initLang(
    $b24: B24Frame,
    localesI18n: ComputedRef<LocaleObject[]>,
    setLocale: (locale: Locale) => Promise<void>
  ) {
    const b24CurrentLang = $b24.getLang()
    if (localesI18n.value.filter(i => i.code === b24CurrentLang).length > 0) {

      // @todo this fix
      await setLocale(b24CurrentLang as 'ru')
      $logger.log('setLocale >>>', b24CurrentLang)
    } else {
      $logger.warn('not support locale >>>', b24CurrentLang)
    }
  }

  /**
   * Reloads data
   */
  async function reloadData() {
    await b24Helper.value?.loadData([
      LoadDataType.AppOptions
    ])

    const data = {
      appSettings: getB24Helper().appOptions
    }

    $logger.log('Reload data >>', data)

    // Update stores with received data
    appSettings.initFromBatch({
      configUfListSettings: data.appSettings?.getJsonObject('configUfListSettings')
    })

    $logger.info('reloadData stop')
  }

  const b24Helper = computed(() => {
    if (isInitB24Helper.value) {
      return getB24Helper()
    }

    return null
  })

  const destroyB24Helper = () => {
    isInitB24Helper.value = false
    destroyB24HelperOry()
  }

  function processErrorGlobal(
    error: unknown | string | Error,
    processErrorData?: ProcessErrorData
  ) {
    $logger.error(error)

    // "No frame" is not a failure of the app — it means the page was opened outside a portal. Show
    // the instruction and a link to the landing, and ignore the caller's error options: they are
    // tuned for in-portal faults and would hide the only useful way out while offering a retry that
    // reloads the same frameless page.
    if (error instanceof FrameUnavailableError) {
      showError({
        statusCode: 503,
        statusMessage: t('error.notInPortalTitle'),
        data: {
          description: t('error.notInPortal'),
          homePageIsHide: false,
          homePageHref: '/',
          isShowClearError: false
        },
        cause: error,
        fatal: true
      })
      return
    }

    // The raw Bitrix error goes to the console for us; the screen gets a sentence a portal user can
    // act on. Showing `[AjaxError] ERROR_CODE (400)` as the heading told them nothing they could do
    // anything about — and it is the first thing a Market reviewer would screenshot.
    let description = t('error.description')

    if (error instanceof AjaxError) {
      // The portal's own message is usually in Russian and specific ("access denied", "not found"),
      // so it is worth showing — the machine code next to it is not.
      description = error.message || description
    } else if (error instanceof Error && error.message) {
      description = error.message
    }

    showError({
      statusCode: 404,
      statusMessage: t('error.title'),
      data: Object.assign({
        description: description,
        homePageIsHide: true,
        isShowClearError: true,
        clearErrorHref: '/app'
      }, (processErrorData ?? {})),
      cause: error,
      fatal: true
    })
  }

  return {
    $logger,
    moduleId,
    initApp,
    initLang,
    reloadData,
    b24Helper,
    usePullClient,
    useSubscribePullClient,
    startPullClient,
    destroyB24Helper,
    processErrorGlobal
  }
}
