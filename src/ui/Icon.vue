<script setup lang="ts">
import { computed } from 'vue'
import { resolveIcon } from './icons'

const props = withDefaults(defineProps<{ name: string; size?: number; label?: string; strokeWidth?: number }>(), { size: 24, strokeWidth: 1.5 })
const component = computed(() => resolveIcon(props.name))
</script>

<template>
  <component
    :is="component"
    v-if="component"
    :size="size"
    :stroke-width="strokeWidth"
    :aria-hidden="label ? undefined : 'true'"
    :aria-label="label"
    :role="label ? 'img' : undefined"
    class="ui-icon"
  />
</template>

<style scoped>
.ui-icon { flex: none; }
</style>
