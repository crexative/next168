<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import ListGroup from '@/ui/ListGroup.vue'
import ListRow from '@/ui/ListRow.vue'

const { t } = useI18n()
const planner = usePlannerStore()

const origin = window.location.origin
const mode = (window as { __NEXT168__?: { mode?: string } }).__NEXT168__?.mode === 'companion' ? 'companion' : 'browser'
</script>

<template>
  <ListGroup v-if="planner.document" :header="t('data.where.title')" :footer="t('data.where.footer')">
    <ListRow :title="t('data.where.mode')" data-testid="data-mode">
      <template #trailing>{{ t(`data.where.modes.${mode}`) }}</template>
    </ListRow>
    <ListRow :title="t('data.where.origin')">
      <template #trailing><span class="wrap" data-testid="data-origin">{{ origin }}</span></template>
    </ListRow>
    <ListRow :title="t('data.where.workspace')">
      <template #trailing><span class="wrap" data-testid="data-workspace">{{ planner.document.workspaceId }}</span></template>
    </ListRow>
  </ListGroup>
</template>

<style scoped>
/* A workspace id is one long unbroken token: it wraps instead of pushing its row wider than the card. */
.wrap { overflow-wrap: anywhere; text-align: end; }
</style>
