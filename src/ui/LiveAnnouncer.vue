<script setup lang="ts">
import { announcement } from './announcer'
</script>

<template>
  <p class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-testid="live-announcer">{{ announcement }}</p>
</template>
