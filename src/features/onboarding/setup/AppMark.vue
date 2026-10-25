<script setup lang="ts">
// Next168's mark, drawn from the app icon: the voice of the questions in the conversation. Decorative.
withDefaults(defineProps<{ size?: number }>(), { size: 32 })
</script>

<template>
  <svg class="app-mark" :width="size" :height="size" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
    <rect width="512" height="512" rx="128" fill="var(--tint)" />
    <circle cx="256" cy="256" r="136" fill="none" stroke="#ffffff" stroke-opacity=".28" stroke-width="40" />
    <path d="M256 120a136 136 0 1 1-96.2 232.2" fill="none" stroke="#ffffff" stroke-width="40" stroke-linecap="round" />
    <circle cx="256" cy="256" r="28" fill="#ffffff" />
  </svg>
</template>

<style scoped>
.app-mark { display: block; flex: none; }
</style>
