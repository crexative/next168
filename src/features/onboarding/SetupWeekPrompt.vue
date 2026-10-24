<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import { openSetup, setupWeekOffered } from './reopen'

// For an empty Today or Week: one button that opens the guided setup. It shows itself only while there is
// nothing planned, so screens can mount it unconditionally in their empty state.
const { t } = useI18n()
const planner = usePlannerStore()

const visible = computed(() => setupWeekOffered(planner))
</script>

<template>
  <Button v-if="visible" class="setup-week" data-testid="setup-week" @click="openSetup()">{{ t('setup.setupWeek') }}</Button>
</template>
