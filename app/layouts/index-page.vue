<script setup lang="ts">
useHead({
  bodyAttrs: {
    class: `light light:[--air-theme-bg-color:#ffffff]`
  }
})
</script>

<template>
  <B24SidebarLayout
    :use-light-content="false"
    :b24ui="{ root: 'overflow-y-hidden' }"
  >
    <!-- Content -->
    <slot />
  </B24SidebarLayout>
</template>
