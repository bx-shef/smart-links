// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AppRatingModal from '~/components/AppRatingModal.vue'

// First component-level suite (G7). The modal's one piece of logic — every dismissal path routes
// through «Позже» — lives in the template/emit layer, invisible to the unit project: a drift
// between the × path and the «Позже» button would split what the server's throttle counts as one
// intent. B24Modal TELEPORTS its body (and needs the B24App overlay context), so these tests
// assert at the component boundary — props in, emits out — not on document.body.
describe('AppRatingModal', () => {
  it('passes the locale texts into the modal chrome', async () => {
    const w = await mountSuspended(AppRatingModal, { props: { open: true } })
    const modal = w.findComponent({ name: 'B24Modal' })
    expect(modal.exists()).toBe(true)
    expect(modal.props('open')).toBe(true)
    expect(String(modal.props('title'))).toContain('Нравится приложение')
    expect(String(modal.props('description')).length).toBeGreaterThan(0)
  })

  it('closing via the modal chrome emits BOTH update:open and later — one intent, one path', async () => {
    const w = await mountSuspended(AppRatingModal, { props: { open: true } })
    const modal = w.findComponent({ name: 'B24Modal' })
    modal.vm.$emit('update:open', false)
    expect(w.emitted('update:open')).toEqual([[false]])
    expect(w.emitted('later')).toHaveLength(1)
  })

  it('re-opening does not emit later (only closing is a dismissal)', async () => {
    const w = await mountSuspended(AppRatingModal, { props: { open: false } })
    const modal = w.findComponent({ name: 'B24Modal' })
    modal.vm.$emit('update:open', true)
    expect(w.emitted('update:open')).toEqual([[true]])
    expect(w.emitted('later')).toBeUndefined()
  })
})
