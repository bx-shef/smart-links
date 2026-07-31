<script setup lang="ts">
defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  rate: []
  reviewed: []
  later: []
}>()

// Dismissing with ESC / the overlay / the × is the same intent as «Позже» — route both through one
// handler so the two paths can never drift (they already differed for anything counting dismissals).
function onOpenChange(value: boolean) {
  emit('update:open', value)
  if (!value) {
    emit('later')
  }
}
</script>

<template>
  <B24Modal
    :open="open"
    :title="$t('rating.title')"
    :description="$t('rating.text')"
    @update:open="onOpenChange"
  >
    <template #footer>
      <div class="flex flex-row flex-wrap items-center gap-2">
        <B24Button
          rounded
          color="air-primary-success"
          :label="$t('rating.rate')"
          @click.stop="emit('rate')"
        />
        <B24Button
          rounded
          color="air-tertiary"
          :label="$t('rating.reviewed')"
          @click.stop="emit('reviewed')"
        />
        <B24Button
          rounded
          color="air-tertiary-no-accent"
          :label="$t('rating.later')"
          @click.stop="emit('later')"
        />
      </div>
    </template>
  </B24Modal>
</template>
