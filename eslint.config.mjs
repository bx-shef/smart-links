// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

// Only rules we actually need turned off live here. Four more used to sit in this block:
// `import/order` and `@typescript-eslint/ban-types` were dead config — neither rule is registered
// in the resolved Nuxt preset at all (ban-types was dropped in typescript-eslint v8), so switching
// them off did nothing but suggest the codebase had a problem it does not have. `import/first` and
// `@typescript-eslint/no-empty-object-type` DO exist and default to error; the codebase has zero
// violations of either, so they are now simply enforced.
export default withNuxt({
  rules: {
    // Pages are routes: `app.vue`, `install.vue`, `index.vue` are named by their URL, and renaming
    // them to satisfy this rule would change the routes.
    'vue/multi-word-component-names': 'off',
    'vue/max-attributes-per-line': ['error', { singleline: 5 }],
    // Debt, not a policy: ~20 `any`s remain, nearly all of them REST payloads from Bitrix24 whose
    // shape the SDK does not type. Narrow them as the shapes get pinned down, then delete this.
    '@typescript-eslint/no-explicit-any': 'off'
  }
})
