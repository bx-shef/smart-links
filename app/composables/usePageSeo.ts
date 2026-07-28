import { usePageStore } from '~/stores/page'

/**
 * In-portal page <head>: title/description follow the page store, which pages fill in at runtime.
 *
 * Getters (not plain values) on purpose — passing `page.title` would freeze the empty string read
 * at setup, so the tab title would never follow a page or locale change. The app name is the
 * fallback so a prerendered shell never ships without a <title>, and `description` is dropped
 * entirely while empty rather than emitting `<meta name="description" content="">`.
 */
export function usePageSeo() {
  const page = usePageStore()
  const { t } = useI18n()

  useSeoMeta({
    title: () => page.title || t('app.name'),
    description: () => page.description || undefined
  })
}
