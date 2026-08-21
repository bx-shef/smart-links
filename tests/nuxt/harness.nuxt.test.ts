// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import Logo from '~/components/Logo.vue'

// Smoke for the nuxt project itself: a component with real DOM output renders under happy-dom
// with auto-imports and the b24 icon pipeline working. If this file starts failing wholesale, the
// harness broke — not the components the other suites blame.
describe('nuxt test harness', () => {
  it('renders a component with real DOM output', async () => {
    const w = await mountSuspended(Logo)
    expect(w.find('svg').exists()).toBe(true)
  })
})
