export interface B24FormConfig {
  formId: number
  secret: string
  loaderScript: string
}

/**
 * Feedback CRM-form config. A FUNCTION (not a module-level const): useRuntimeConfig() needs the
 * Nuxt context, so evaluating it at import time breaks SSR/prerender of the page that imports it.
 */
export function useB24FormConfig(): B24FormConfig {
  const config = useRuntimeConfig()
  return {
    formId: Number(config.public.b24FormId) || 0,
    secret: config.public.b24FormSecret || '',
    loaderScript: config.public.b24FormLoaderScript || ''
  }
}
