import type { RouteLocationNormalized } from 'vue-router'
import { isPublicRoute } from '~/utils/routes'
import { useB24 } from '~/composables/useB24'

// Global middleware: routes a Bitrix24 SLIDER frame to its page based on placement.options.place.
// It must NOT import the B24 SDK statically — being global, it lands in the entry chunk, which
// the public landing loads. The SDK is pulled in lazily by useB24().init() instead.

const baseDir = '/'

function isSkipB24(toPath: string): boolean {
  return isPublicRoute(toPath)
    || toPath.includes(`${baseDir}eula`)
    || toPath.includes(`${baseDir}render`)
}

export default defineNuxtRouteMiddleware(async (
  to: RouteLocationNormalized,
  from: RouteLocationNormalized
) => {
  const isUseB24Frame = useState('isUseB24Frame', () => true)

  // Never touch the frame during SSR/prerender.
  if (import.meta.server) {
    return
  }

  if (import.meta.dev) {
    console.log('[middleware] start', { to: to.path, from: from.path })
  }

  if (isSkipB24(to.path)) {
    isUseB24Frame.value = false
    return Promise.resolve()
  }

  try {
    const $b24 = await useB24().init()
    if (!$b24) {
      return // not inside a portal — leave the page to handle it
    }

    if ($b24.placement.options?.place) {
      const optionsPlace: string = $b24.placement.options.place
      let goTo: null | string = null

      if (optionsPlace === 'app-options') {
        goTo = `${baseDir}slider/app-options`
      } else if (optionsPlace === 'feedback') {
        goTo = `${baseDir}slider/feedback`
      }

      if (
        null !== goTo
        && to.path !== goTo
      ) {
        return navigateTo(goTo)
      }
    }
  } catch (error: any) {
    const appError = createError({
      statusCode: 404,
      statusMessage: error?.message || error,
      data: {
        description: 'Problem in middleware',
        homePageIsHide: true,
        isShowClearError: false
      },
      cause: error,
      fatal: true
    })

    console.error(appError)

    showError(appError)
    return Promise.reject(appError)
  }
})
